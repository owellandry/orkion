import type { ProviderName } from "../config/types.ts";
import type { ModelPolicyResolver } from "../providers/model-policy-resolver.ts";
import type { ProviderRegistry } from "../providers/provider-registry.ts";
import type { LLMProvider } from "../providers/types.ts";
import { shouldDelegateTask } from "./research-intent.ts";
import { IntentAgent } from "./intent-agent.ts";
import type {
  AgentTaskResult,
  DelegationPlan,
  ExecutionObserver,
  IntentAnalysis,
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

function buildDateTimeAnswer(task: TaskRequest): string {
  const now = new Date();
  const goal = (task.resolvedGoal ?? task.goal).toLowerCase();
  const wantsTime = /\bhora\b|\btime\b/.test(goal);
  const wantsDate = /\bdia\b|\bfecha\b|\bdate\b|\btoday\b/.test(goal) || !wantsTime;

  const dateText = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(now);

  const timeText = new Intl.DateTimeFormat("es-CO", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }).format(now);

  if (wantsDate && wantsTime) {
    return `Hoy es ${dateText} y la hora actual es ${timeText}.`;
  }

  if (wantsTime) {
    return `La hora actual es ${timeText}.`;
  }

  return `Hoy es ${dateText}.`;
}

function pickVariant(seed: string, variants: string[]): string {
  const value = [...seed].reduce((accumulator, char) => accumulator + char.charCodeAt(0), 0);
  return variants[value % variants.length] ?? variants[0];
}

function buildSimpleChatAnswer(task: TaskRequest): string | undefined {
  const goal = (task.resolvedGoal ?? task.goal).toLowerCase().trim();

  if (
    /^(hola|buenas|hey|holi)\b/.test(goal) ||
    /\bque tal\b/.test(goal) ||
    /\bcomo estas\b/.test(goal) ||
    /\bcomo vas\b/.test(goal) ||
    /\bcomo te va\b/.test(goal) ||
    /\bcomo andas\b/.test(goal) ||
    /\btodo bien\b/.test(goal)
  ) {
    return pickVariant(goal, [
      "Hola, voy bien por aqui. Listo para ayudarte con lo que necesites.",
      "Todo en orden por aqui. Dime y le damos.",
      "Voy bien, gracias. Si quieres seguimos con lo que tengas entre manos.",
      "Bien por aqui. Cuentame que necesitas y lo resolvemos."
    ]);
  }

  if (/\bgracias\b/.test(goal)) {
    return pickVariant(goal, [
      "Con gusto.",
      "De una.",
      "Para eso estoy.",
      "Claro, seguimos cuando quieras."
    ]);
  }

  return undefined;
}

function buildConversationBlock(task: TaskRequest): string {
  if (!task.context?.length) {
    return "";
  }

  return ["Historial reciente:", ...task.context].join("\n");
}

function buildDirectPrompt(task: TaskRequest, intent: ResearchIntent): string {
  return [
    "Responde la tarea del usuario de forma breve, util y contextual.",
    "Si el mensaje actual depende de turnos anteriores, usa el historial reciente.",
    `Intento detectado: ${intent.type}`,
    `Tarea original: ${task.goal}`,
    task.resolvedGoal && task.resolvedGoal !== task.goal ? `Consulta refinada: ${task.resolvedGoal}` : "",
    buildConversationBlock(task)
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
    "Si el mensaje actual depende de turnos anteriores, usa el historial reciente.",
    `Intento detectado: ${intent.type}`,
    `Objetivo original: ${task.goal}`,
    task.resolvedGoal && task.resolvedGoal !== task.goal ? `Consulta refinada: ${task.resolvedGoal}` : "",
    buildConversationBlock(task),
    `Confianza del subagente: ${workerResult.confidence}`,
    `Resumen ejecutivo del subagente: ${workerResult.reasoningSummary}`,
    `Hallazgos: ${workerResult.summary}`,
    workerResult.sources.length > 0 ? `Fuentes consultadas: ${buildSourceLine(workerResult.sources)}` : "",
    workerResult.errors.length ? `Errores: ${workerResult.errors.join(" | ")}` : "",
    "Si la confianza es media o baja, anade una nota breve de incertidumbre y menciona las fuentes consultadas."
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

function buildExactOperationalAnswer(workerResult: AgentTaskResult): string {
  if (workerResult.summary.trim()) {
    return workerResult.summary.trim();
  }

  if (workerResult.errors.length > 0) {
    return workerResult.errors.join("\n");
  }

  return workerResult.reasoningSummary.trim();
}

function sanitizeAssistantText(text: string): string {
  let cleaned = text.trim();
  if (!cleaned) {
    return cleaned;
  }

  const responseMarker = cleaned.match(/(?:^|\n)\s*respuesta\s*:?\s*([\s\S]*)$/i);
  if (responseMarker?.[1]?.trim()) {
    cleaned = responseMarker[1].trim();
  }

  const metaStarts = [
    /^okay,\s*el usuario/i,
    /^el usuario pregunta/i,
    /^parece que se refiere/i,
    /^sin mas contexto/i,
    /^posibles interpretaciones/i,
    /^respuesta breve/i,
    /^debo responder/i,
    /^necesito contexto/i
  ];

  const paragraphs = cleaned.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  if (paragraphs.length > 1 && metaStarts.some((pattern) => pattern.test(paragraphs[0]))) {
    const candidate = paragraphs.reverse().find((paragraph) => !metaStarts.some((pattern) => pattern.test(paragraph)));
    if (candidate) {
      cleaned = candidate;
    }
  }

  const lines = cleaned
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => {
      const lowered = line.toLowerCase();
      return !(
        lowered.startsWith("okay, el usuario") ||
        lowered.startsWith("el usuario pregunta") ||
        lowered.startsWith("parece que se refiere") ||
        lowered.startsWith("posibles interpretaciones") ||
        lowered.startsWith("debo responder") ||
        lowered.startsWith("necesito contexto")
      );
    });

  return lines.join("\n").trim();
}

export class ManagerAgent {
  private readonly intentAgent: IntentAgent;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly modelPolicy: ModelPolicyResolver,
    private readonly workers: SubAgent[],
    intentAgent?: IntentAgent
  ) {
    this.intentAgent = intentAgent ?? new IntentAgent();
  }

  async run(task: TaskRequest, observer?: ExecutionObserver): Promise<ManagerExecutionResult> {
    const analysis = this.intentAgent.analyze(task);
    const preparedTask: TaskRequest = {
      ...task,
      resolvedGoal: analysis.resolvedGoal,
      intentHint: analysis.intent.type,
      intentAnalysis: analysis
    };
    const intent = analysis.intent;

    observer?.({
      scope: "manager",
      kind: "status",
      message: `Intencion detectada: ${intent.type}.`,
      data: {
        title: "pensando",
        detail: `intencion: ${intent.type} | entidad: ${intent.targetEntity}`
      }
    });
    if (analysis.strippedTokens.length > 0 || analysis.resolvedGoal !== task.goal) {
      observer?.({
        scope: "manager",
        kind: "status",
        message: "Refinando la intencion del usuario.",
        data: {
          title: "pensando",
          detail: `consulta limpia: ${analysis.resolvedGoal}`
        }
      });
    }
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
      preferredProvider: preparedTask.preferredProvider,
      preferredModel: preparedTask.preferredModel
    });
    const provider = this.registry.createProvider(selection.provider);
    const plan = this.createPlan(preparedTask, analysis, selection.provider, selection.model, selection.fallbackUsed, selection.warnings);

    observer?.({
      scope: "manager",
      kind: "status",
      message: `Provider elegido: ${selection.provider}. Modelo: ${selection.model}.`,
      data: {
        title: "pensando",
        detail: `provider: ${selection.provider} | model: ${selection.model}`
      }
    });

    const targetWorker = this.workers.find((worker) => worker.canHandle(preparedTask));

    if (!plan.shouldDelegate || !targetWorker) {
      if (intent.type === "date_time") {
        return {
          text: buildDateTimeAnswer(preparedTask),
          delegated: false,
          plan
        };
      }

      if (intent.type === "chat") {
        const localChatAnswer = buildSimpleChatAnswer(preparedTask);
        if (localChatAnswer) {
          return {
            text: localChatAnswer,
            delegated: false,
            plan
          };
        }
      }

      const text = await this.generateManagerResponse(provider, {
        task: preparedTask,
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
      message: `Delegando la consulta al agente ${targetWorker.name}.`,
      data: {
        title: `${targetWorker.name} esta investigando`,
        detail: `objetivo: ${intent.targetEntity}`
      }
    });

    const workerResult = await targetWorker.execute(preparedTask, plan, {
      observer,
      provider
    });

    if (intent.type === "git_operation") {
      return {
        text: buildExactOperationalAnswer(workerResult),
        delegated: true,
        plan,
        workerResult
      };
    }

    const text = await this.generateManagerResponse(provider, {
      task: preparedTask,
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
    analysis: IntentAnalysis,
    provider: ProviderName,
    model: string,
    fallbackUsed: boolean,
    warnings: string[]
  ): DelegationPlan {
    const delegated = shouldDelegateTask(task.resolvedGoal ?? task.goal);
    const targetWorker = this.workers.find((worker) => worker.canHandle(task));

    return {
      selectedAgent: delegated && targetWorker ? targetWorker.name : null,
      instructions: delegated
        ? "Resuelve la tarea delegada. Prioriza resultados concretos y oficiales."
        : "Respond directly without delegating.",
      expectedOutput: delegated ? "Structured result from the sub-agent." : "Direct answer for the user.",
      shouldDelegate: delegated,
      provider,
      model,
      fallbackUsed,
      warnings,
      intentType: analysis.intent.type,
      researchRequired: analysis.intent.researchRequired,
      researchBudget: delegated
        ? {
            ...DEFAULT_RESEARCH_BUDGET,
            maxRounds: analysis.intent.type === "definition" ? 4 : DEFAULT_RESEARCH_BUDGET.maxRounds,
            maxVisitedUrls: analysis.intent.type === "definition" ? 10 : DEFAULT_RESEARCH_BUDGET.maxVisitedUrls
          }
        : undefined
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

      const response = await provider.generateText({
        model: input.plan.model,
        systemPrompt: [
          "Eres el manager de un sistema multi-agente.",
          "No te rindas tras una busqueda fallida.",
          "Responde con evidencia, evita frases vagas y no pidas ayuda al usuario si todavia existe una conclusion sustentable.",
          "No reveles razonamiento interno, cadena de pensamiento, analisis oculto, notas privadas ni meta-comentarios sobre el usuario.",
          "No escribas frases como 'el usuario pregunta', 'necesito contexto', 'posibles interpretaciones' o similares.",
          "Entrega solo la respuesta final para el usuario, en espanol, salvo que el usuario pida otro idioma."
        ].join(" "),
        prompt
      });

      const cleanText = sanitizeAssistantText(response.text);
      if (cleanText.length > 0) {
        input.observer?.({
          scope: "provider",
          kind: "done",
          message: "Respuesta del modelo completada.",
          data: {
            title: "sintesis final lista",
            detail: `model: ${input.plan.model}`
          }
        });
        return cleanText;
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
