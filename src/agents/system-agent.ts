import { McpClientAdapter, type McpClientLike } from "../mcp/client-adapter.ts";
import type {
  AgentExecutionContext,
  AgentTaskResult,
  DelegationPlan,
  ExecutionEvent,
  SubAgent,
  TaskRequest,
  ToolCallRecord
} from "../types/agent.ts";

export const SYSTEM_AGENT_NAME = "system";
export const SYSTEM_AGENT_PROMPT = [
  "Eres System, el experto en el sistema operativo y shell de Orkion.",
  "Tu trabajo es decidir que comandos ejecutar para cumplir la tarea del usuario.",
  "No dependes de reglas quemadas; observas el objetivo, eliges herramientas y verificas el resultado.",
  "En Windows usa PowerShell cuando sea conveniente.",
  "No des por completada una tarea sin evidencia real de verificacion.",
  "Si la tarea implica archivos o carpetas, verifica rutas absolutas y el contenido final cuando aplique.",
  "Siempre responde en JSON estricto."
].join(" ");

interface SystemCommandResult {
  success?: boolean;
  cwd?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
}

interface SystemArtifact {
  kind: "directory" | "file" | "command_output" | "other";
  path?: string;
  details?: string;
}

interface SystemAction {
  command?: string;
  verifyCommand?: string;
  done?: boolean;
  summary?: string;
  artifacts?: SystemArtifact[];
}

interface ExecutedStep {
  command: string;
  result: SystemCommandResult;
  verifyCommand?: string;
  verifyResult?: SystemCommandResult;
}

class SystemPlannerTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`System planner timed out after ${timeoutMs}ms`);
    this.name = "SystemPlannerTimeoutError";
  }
}

function emit(
  context: AgentExecutionContext | undefined,
  scope: ExecutionEvent["scope"],
  message: string,
  data?: Record<string, unknown>
): void {
  context?.observer?.({ scope, kind: "status", message, data });
}

function shortText(value: string, maxLength = 96): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function parseJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function buildContextBlock(task: TaskRequest): string {
  if (!task.context?.length) {
    return "";
  }

  return ["Recent context:", ...task.context].join("\n");
}

function buildPlannerPrompt(task: TaskRequest, evidence: string[], osContext?: SystemCommandResult): string {
  return [
    `Goal: ${task.resolvedGoal ?? task.goal}`,
    buildContextBlock(task),
    osContext?.cwd ? `Workspace cwd: ${osContext.cwd}` : "",
    evidence.length > 0 ? `Execution evidence:\n${evidence.join("\n\n")}` : "",
    "Return ONLY valid JSON.",
    'When work is needed, return {"command":"...","verifyCommand":"..."}',
    'When and only when the task is complete and verified, return {"done":true,"summary":"...","artifacts":[...]}',
    "Artifacts should describe the real result for the user, for example a created directory path or a created file path.",
    "Do not include shell commands inside summary unless the user explicitly asked for them.",
    "For filesystem tasks, prefer verification commands that output JSON or absolute paths."
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatArtifacts(artifacts: SystemArtifact[]): string[] {
  return artifacts
    .map((artifact) => {
      if (artifact.kind === "directory" && artifact.path) {
        return `Carpeta: ${artifact.path}`;
      }

      if (artifact.kind === "file" && artifact.path) {
        return artifact.details ? `Archivo: ${artifact.path} (${artifact.details})` : `Archivo: ${artifact.path}`;
      }

      if (artifact.path && artifact.details) {
        return `${artifact.path}: ${artifact.details}`;
      }

      if (artifact.path) {
        return artifact.path;
      }

      return artifact.details ?? "";
    })
    .filter(Boolean);
}

function buildFallbackSummary(osContext: SystemCommandResult | undefined, steps: ExecutedStep[]): string {
  const lastStep = steps[steps.length - 1];
  const verificationText = lastStep?.verifyResult?.stdout?.trim() || lastStep?.result.stdout?.trim() || "";

  return [
    "Hecho.",
    osContext?.cwd ? `Ubicacion base: ${osContext.cwd}` : "",
    verificationText ? `Resultado verificado:\n${verificationText}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPlannerFailureSummary(task: TaskRequest, plan: DelegationPlan, evidence: string[]): string {
  const diagnostics = evidence.slice(-3).join(" | ");
  return [
    `System no pudo planificar correctamente la tarea con ${plan.provider}/${plan.model}.`,
    "No se ejecuto ningun comando del shell en este intento.",
    diagnostics ? `Diagnostico: ${diagnostics}` : "",
    `Tarea original: ${task.goal}`
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSystemErrorSummary(error: unknown, plan: DelegationPlan): string {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();

  if (lowered.includes("429") || lowered.includes("rate limit")) {
    return [
      `System no pudo planificar la tarea porque el modelo ${plan.provider}/${plan.model} devolvio un limite de uso (429).`,
      "No se ejecuto ningun comando del shell en este intento.",
      "Puedes reintentar luego o cambiar el modelo con /model para seguir."
    ].join("\n");
  }

  if (lowered.includes("timed out") || lowered.includes("timeout")) {
    return [
      `System no pudo planificar la tarea porque el modelo ${plan.provider}/${plan.model} tardo demasiado en responder.`,
      "No se ejecuto ningun comando del shell en este intento.",
      "Puedes cambiar el modelo con /model o reintentar cuando el provider responda mejor."
    ].join("\n");
  }

  return `System fallo al ejecutar comandos en el shell.\nDetalle: ${message}`;
}

function buildUserSummary(action: SystemAction, osContext: SystemCommandResult | undefined, steps: ExecutedStep[]): string {
  const summary = action.summary?.trim();
  const artifactLines = action.artifacts ? formatArtifacts(action.artifacts) : [];

  const lines = [
    summary || "Hecho.",
    ...artifactLines,
    osContext?.cwd ? `Ubicacion base: ${osContext.cwd}` : ""
  ].filter(Boolean);

  return lines.length > 0 ? lines.join("\n") : buildFallbackSummary(osContext, steps);
}

async function runSystemCommand(
  client: McpClientLike,
  toolCalls: ToolCallRecord[],
  command: string
): Promise<SystemCommandResult> {
  const response = await client.callTool("runCommand", { command });
  toolCalls.push({ toolName: "runCommand", arguments: { command }, resultPreview: shortText(response.text) });
  return parseJson<SystemCommandResult>(response.text) ?? {
    success: false,
    error: "No se pudo interpretar la salida del comando."
  };
}

async function requestPlannerAction(
  context: AgentExecutionContext,
  plan: DelegationPlan,
  systemPrompt: string,
  prompt: string,
  timeoutMs: number
): Promise<SystemAction> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SystemPlannerTimeoutError(timeoutMs)), timeoutMs);
    timer.unref?.();
  });

  const response = await Promise.race([
    context.provider!.generateText({
      model: plan.model,
      temperature: 0.1,
      systemPrompt,
      prompt
    }),
    timeoutPromise
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });

  const raw = response.text.trim().replace(/```json/gi, "").replace(/```/g, "").trim();
  const action = parseJson<SystemAction>(raw);
  if (!action) {
    throw new Error(`System planner returned invalid JSON: ${raw}`);
  }

  return action;
}

export class SystemAgent implements SubAgent {
  readonly name = SYSTEM_AGENT_NAME;
  readonly prompt = SYSTEM_AGENT_PROMPT;

  constructor(
    private readonly clientFactory: () => McpClientLike = () => new McpClientAdapter(),
    private readonly plannerTimeoutMs = 30000
  ) {}

  canHandle(task: TaskRequest): boolean {
    return (
      task.intentHint === "system_operation" ||
      /\b(comando|consola|terminal|bash|shell|sistema|carpeta|directorio|archivo|file)\b/i.test(task.goal)
    );
  }

  async execute(task: TaskRequest, plan: DelegationPlan, context?: AgentExecutionContext): Promise<AgentTaskResult> {
    const client = this.clientFactory();
    const toolCalls: ToolCallRecord[] = [];
    const evidence: string[] = [];
    const executedSteps: ExecutedStep[] = [];
    let osContext: SystemCommandResult | undefined;

    emit(context, "agent", "System inicializando contexto del sistema.", {
      title: "system esta analizando",
      detail: "objetivo: operaciones de sistema"
    });

    try {
      emit(context, "mcp", "Conectando con MCP de Sistema.", {
        title: "preparando shell",
        detail: "mcp del sistema listo"
      });

      const tools = await client.listTools();
      if (!tools.includes("runCommand")) {
        throw new Error("El MCP de system no expone runCommand.");
      }

      if (tools.includes("getOsContext")) {
        const response = await client.callTool("getOsContext", {});
        toolCalls.push({ toolName: "getOsContext", arguments: {}, resultPreview: "OS context retrieved" });
        evidence.push(`OS Context: ${response.text}`);
        osContext = parseJson<SystemCommandResult>(response.text);
      }

      if (!context?.provider) {
        throw new Error("Se requiere un LLMProvider para el agente System.");
      }

      const maxRounds = 8;
      let currentRound = 0;
      let finalSummary = "Hecho.";

      while (currentRound < maxRounds) {
        currentRound += 1;

        emit(context, "agent", `System planifica la ronda ${currentRound}.`, {
          title: "system pensando",
          detail: `ronda ${currentRound}/${maxRounds} | modelo: ${plan.model}`
        });

        let action: SystemAction;
        try {
          action = await requestPlannerAction(
            context,
            plan,
            this.prompt,
            buildPlannerPrompt(task, evidence, osContext),
            this.plannerTimeoutMs
          );
        } catch (error) {
          if (error instanceof SystemPlannerTimeoutError) {
            throw error;
          }

          emit(context, "agent", "El modelo fallo al responder JSON, reintentando...", {
            title: "system pensando",
            detail: "error de formato JSON"
          });
          evidence.push(`Planner error: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }

        if (action.done) {
          if (executedSteps.length === 0) {
            evidence.push("Planner error: intento finalizar sin ejecutar ningun comando.");
            continue;
          }

          finalSummary = buildUserSummary(action, osContext, executedSteps);
          break;
        }

        if (!action.command) {
          evidence.push("Planner error: falta command o done=true.");
          continue;
        }

        emit(context, "mcp", `Ejecutando: ${action.command}`, {
          title: "system esta ejecutando",
          detail: shortText(action.command)
        });
        const commandResult = await runSystemCommand(client, toolCalls, action.command);

        let verifyResult: SystemCommandResult | undefined;
        if (action.verifyCommand) {
          emit(context, "mcp", `Verificando: ${action.verifyCommand}`, {
            title: "system esta verificando",
            detail: shortText(action.verifyCommand)
          });
          verifyResult = await runSystemCommand(client, toolCalls, action.verifyCommand);
        }

        executedSteps.push({
          command: action.command,
          result: commandResult,
          verifyCommand: action.verifyCommand,
          verifyResult
        });

        evidence.push(
          [
            `Command: ${action.command}`,
            `Result: ${JSON.stringify(commandResult)}`,
            action.verifyCommand ? `Verify command: ${action.verifyCommand}` : "",
            verifyResult ? `Verify result: ${JSON.stringify(verifyResult)}` : ""
          ]
            .filter(Boolean)
            .join("\n")
        );
      }

      if (executedSteps.length === 0) {
        throw new Error(buildPlannerFailureSummary(task, plan, evidence));
      }

      if (executedSteps.length > 0 && finalSummary === "Hecho.") {
        finalSummary = buildFallbackSummary(osContext, executedSteps);
      }

      context?.observer?.({
        scope: "agent",
        kind: "done",
        message: "System termino las operaciones de sistema.",
        data: {
          title: "system finalizo",
          detail: "operacion de consola completada"
        }
      });

      return {
        status: "success",
        summary: finalSummary,
        data: {
          executedSteps
        },
        toolCalls,
        errors: [],
        confidence: "high",
        sources: [],
        queriesTried: [],
        visitedUrls: [],
        officialSourceFound: true,
        reasoningSummary: finalSummary
      };
    } catch (error) {
      context?.observer?.({
        scope: "agent",
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
        data: {
          title: "system encontro un problema",
          detail: "error en la operacion de sistema"
        }
      });

      return {
        status: "error",
        summary: buildSystemErrorSummary(error, plan),
        toolCalls,
        errors: [error instanceof Error ? error.message : String(error)],
        confidence: "low",
        sources: [],
        queriesTried: [],
        visitedUrls: [],
        officialSourceFound: false,
        reasoningSummary: buildSystemErrorSummary(error, plan)
      };
    } finally {
      await client.close();
    }
  }
}
