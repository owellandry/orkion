import type { ProviderName } from "../config/types.ts";
import type { ModelPolicyResolver } from "../providers/model-policy-resolver.ts";
import type { ProviderRegistry } from "../providers/provider-registry.ts";
import type { LLMProvider } from "../providers/types.ts";
import { interpretResearchIntent, shouldDelegateTask } from "./research-intent.ts";
import type {
  AgentTaskResult,
  DelegationPlan,
  ExecutionObserver,
  ManagerExecutionResult,
  ResearchBudget,
  ResearchIntent,
  ResearchSource,
  SubAgent,
  TaskRequest
} from "../types/agent.ts";

const DEFAULT_RESEARCH_BUDGET: ResearchBudget = {
  maxRounds: 6,
  maxVisitedUrls: 16,
  maxReformulations: 4,
  maxSearchQueriesPerRound: 3,
  maxPagesPerRound: 3
};

function buildDirectPrompt(task: TaskRequest, intent: ResearchIntent): string {
  return [
    "Responde la tarea del usuario de forma breve y util.",
    `Intento detectado: ${intent.type}`,
    `Tarea: ${task.goal}`,
    task.context?.length ? `Contexto adicional: ${task.context.join(" | ")}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSourceLine(sources: ResearchSource[]): string {
  return sources.map((source) => `${source.domain} (${source.kind})`).join(", ");
}

function buildDelegatedPrompt(task: TaskRequest, workerResult: AgentTaskResult, intent: ResearchIntent): string {
  return [
    "Eres el manager de Orkion.",
    "Responde con una conclusion directa y sustentada por la evidencia del subagente.",
    "No pidas mas contexto ni digas que el usuario te ayude, salvo que la evidencia sea realmente insuficiente.",
    `Intento detectado: ${intent.type}`,
    `Objetivo original: ${task.goal}`,
    `Confianza del subagente: ${workerResult.confidence}`,
    `Resumen ejecutivo del subagente: ${workerResult.reasoningSummary}`,
    `Hallazgos: ${workerResult.summary}`,
    workerResult.sources.length > 0 ? `Fuentes consultadas: ${buildSourceLine(workerResult.sources)}` : "",
    workerResult.errors.length ? `Errores: ${workerResult.errors.join(" | ")}` : "",
    "Si la confianza es media o baja, añade una nota breve de incertidumbre y menciona las fuentes consultadas."
  ]
    .filter(Boolean)
    .join("\n");
}

function buildFallbackAnswer(task: TaskRequest, provider: ProviderName, model: string, workerResult?: AgentTaskResult): string {
  if (!workerResult) {
    return `Orkion resolvio la tarea "${task.goal}" usando ${provider}/${model}, pero tuvo que devolver una respuesta local de fallback.`;
  }

  const parts = [
    `Orkion uso ${provider}/${model}.`,
    workerResult.reasoningSummary || workerResult.summary
  ];

  if (workerResult.confidence !== "high" && workerResult.sources.length > 0) {
    parts.push(`Fuentes consultadas: ${buildSourceLine(workerResult.sources)}`);
  }

  return parts.join("\n\n");
}

export class ManagerAgent {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly modelPolicy: ModelPolicyResolver,
    private readonly worker: SubAgent
  ) {}

  async run(task: TaskRequest, observer?: ExecutionObserver): Promise<ManagerExecutionResult> {
    const intent = interpretResearchIntent(task.goal);

    observer?.({
      scope: "manager",
      kind: "status",
      message: `Intencion detectada: ${intent.type}.`,
      data: {
        title: "pensando",
        detail: `intencion: ${intent.type} | entidad: ${intent.targetEntity}`
      }
    });
    observer?.({
      scope: "manager",
      kind: "status",
      message: "Analizando la tarea y resolviendo provider/modelo.",
      data: {
        title: "pensando",
        detail: "revisando config, credenciales y modelo"
      }
    });

    const selection = this.modelPolicy.resolve({
      preferredProvider: task.preferredProvider,
      preferredModel: task.preferredModel
    });
    const provider = this.registry.createProvider(selection.provider);
    const plan = this.createPlan(task, intent, selection.provider, selection.model, selection.fallbackUsed, selection.warnings);

    observer?.({
      scope: "manager",
      kind: "status",
      message: `Provider elegido: ${selection.provider}. Modelo: ${selection.model}.`,
      data: {
        title: "pensando",
        detail: `provider: ${selection.provider} | model: ${selection.model}`
      }
    });

    if (!plan.shouldDelegate) {
      const text = await this.generateManagerResponse(provider, {
        task,
        plan,
        intent,
        observer
      });

      return {
        text,
        delegated: false,
        plan
      };
    }

    observer?.({
      scope: "manager",
      kind: "status",
      message: `Delegando la consulta al agente ${this.worker.name}.`,
      data: {
        title: "lyra esta investigando",
        detail: `objetivo: ${intent.targetEntity}`
      }
    });

    const workerResult = await this.worker.execute(task, plan, {
      observer,
      provider
    });
    const text = await this.generateManagerResponse(provider, {
      task,
      plan,
      intent,
      workerResult,
      observer
    });

    return {
      text,
      delegated: true,
      plan,
      workerResult
    };
  }

  private createPlan(
    task: TaskRequest,
    intent: ResearchIntent,
    provider: ProviderName,
    model: string,
    fallbackUsed: boolean,
    warnings: string[]
  ): DelegationPlan {
    const delegated = shouldDelegateTask(task.goal);

    return {
      selectedAgent: delegated ? this.worker.name : null,
      instructions: delegated
        ? "Investiga de forma persistente, prioriza fuentes oficiales y responde con evidencia."
        : "Respond directly without delegating.",
      expectedOutput: delegated ? "Structured research result with confidence and sources." : "Direct answer for the user.",
      shouldDelegate: delegated,
      provider,
      model,
      fallbackUsed,
      warnings,
      intentType: intent.type,
      researchRequired: intent.researchRequired,
      researchBudget: delegated ? DEFAULT_RESEARCH_BUDGET : undefined
    };
  }

  private async generateManagerResponse(
    provider: LLMProvider,
    input: {
      task: TaskRequest;
      plan: DelegationPlan;
      intent: ResearchIntent;
      workerResult?: AgentTaskResult;
      observer?: ExecutionObserver;
    }
  ): Promise<string> {
    try {
      const prompt = input.workerResult
        ? buildDelegatedPrompt(input.task, input.workerResult, input.intent)
        : buildDirectPrompt(input.task, input.intent);

      input.observer?.({
        scope: "provider",
        kind: "status",
        message: `Solicitando respuesta al modelo ${input.plan.model}.`,
        data: {
          title: "sintetizando respuesta",
          detail: `provider: ${input.plan.provider} | model: ${input.plan.model}`
        }
      });

      const response = await provider.streamText({
        model: input.plan.model,
        systemPrompt:
          "Eres el manager de un sistema multi-agente. No te rindas tras una busqueda fallida. Responde con evidencia, evita frases vagas y no pidas ayuda al usuario si todavia existe una conclusion sustentable.",
        prompt,
        onToken: (chunk) => {
          input.observer?.({
            scope: "provider",
            kind: "stream",
            message: "chunk",
            chunk
          });
        }
      });

      if (response.text.trim().length > 0) {
        input.observer?.({
          scope: "provider",
          kind: "done",
          message: "Respuesta del modelo completada.",
          data: {
            title: "sintesis final lista",
            detail: `model: ${input.plan.model}`
          }
        });
        return response.text.trim();
      }
    } catch (error) {
      input.observer?.({
        scope: "provider",
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
        data: {
          title: "sintesis con error",
          detail: "se usara fallback local si hace falta"
        }
      });
    }

    return buildFallbackAnswer(input.task, input.plan.provider, input.plan.model, input.workerResult);
  }
}
