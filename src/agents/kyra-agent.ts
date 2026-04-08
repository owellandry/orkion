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

export const KYRA_AGENT_NAME = "kyra";
export const KYRA_AGENT_PROMPT = [
  "Eres Kyra, la experta en control de versiones y Git de Orkion.",
  "Tienes contexto total del sistema operativo y acceso a comandos de git.",
  "Puedes crear ramas, hacer commits, merges y organizar repositorios.",
  "Nunca pidas confirmacion al usuario a menos que sea una accion destructiva severa (ej. un push forzado a main).",
  "Piensa paso a paso, verifica el estado antes de hacer cambios ('git status', 'git branch') y documenta claramente el resultado final."
].join(" ");

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

export class GitAgent implements SubAgent {
  readonly name = KYRA_AGENT_NAME;
  readonly prompt = KYRA_AGENT_PROMPT;

  constructor(private readonly clientFactory: () => McpClientLike) {}

  canHandle(task: TaskRequest): boolean {
    // Kyra maneja todo lo relacionado a git
    const isGit = /\bgit\b/i.test(task.goal) || 
                  /\bcommit\b/i.test(task.goal) || 
                  /\bpush\b/i.test(task.goal) ||
                  /\brama\b/i.test(task.goal);
    return isGit;
  }

  async execute(task: TaskRequest, plan: DelegationPlan, context?: AgentExecutionContext): Promise<AgentTaskResult> {
    const client = this.clientFactory();
    const toolCalls: ToolCallRecord[] = [];
    const evidence: string[] = [];
    
    emit(context, "agent", "Kyra inicializando entorno Git.", {
      title: "kyra esta analizando",
      detail: `objetivo: operaciones git`
    });

    try {
      emit(context, "mcp", "Conectando con MCP de Git.", {
        title: "preparando git",
        detail: "mcp de git listo"
      });
      
      const tools = await client.listTools();
      
      if (tools.includes("getOsContext")) {
        const response = await client.callTool("getOsContext", {});
        toolCalls.push({ toolName: "getOsContext", arguments: {}, resultPreview: "OS context retrieved" });
        evidence.push(`OS Context: ${response.text}`);
      }

      if (!context?.provider) {
        throw new Error("Se requiere un LLMProvider para el agente Kyra.");
      }

      // Ciclo interactivo con el LLM para decidir comandos de git
      let currentRound = 0;
      const maxRounds = 8;
      let finalSummary = "Operacion completada con exito.";

      // Initial prompt includes the task, the OS context
      let currentPrompt = `Goal: ${task.goal}\nContext:\n${evidence.join("\n")}\nWhat git command should we run first? Return ONLY a valid JSON object with {"command": "git status"} or {"done": true, "summary": "what was done"}.`;

      while (currentRound < maxRounds) {
        currentRound++;
        
        const response = await context.provider.generateText({
          model: plan.model,
          temperature: 0.1,
          systemPrompt: this.prompt + " Always respond in strict JSON format: {\"command\": \"git <cmd>\"} OR {\"done\": true, \"summary\": \"final summary\"}.",
          prompt: currentPrompt
        });

        const raw = response.text.trim().replace(/^```json/, "").replace(/```$/, "").trim();
        
        let action: any;
        try {
          action = JSON.parse(raw);
        } catch (err) {
          emit(context, "agent", "El modelo fallo al responder JSON, reintentando...", {
            title: "kyra pensando",
            detail: "error de formato JSON"
          });
          currentPrompt += `\nError: Please respond in strict JSON format. You gave: ${raw}`;
          continue;
        }

        if (action.done) {
          finalSummary = action.summary || "Tareas de git completadas.";
          break;
        }

        if (action.command) {
          emit(context, "mcp", `Ejecutando: ${action.command}`, {
            title: "kyra esta ejecutando",
            detail: shortText(action.command)
          });

          const mcpResponse = await client.callTool("gitExec", { command: action.command });
          toolCalls.push({ toolName: "gitExec", arguments: { command: action.command }, resultPreview: shortText(mcpResponse.text) });
          
          evidence.push(`Command: ${action.command}\nResult: ${mcpResponse.text}`);
          
          currentPrompt = `Goal: ${task.goal}\nLast execution:\n${action.command}\nResult:\n${mcpResponse.text}\n\nWhat is the next step? Return ONLY JSON {"command": "git ..."} or {"done": true, "summary": "..."}`;
        }
      }

      context?.observer?.({
        scope: "agent",
        kind: "done",
        message: "Kyra termino las operaciones de git.",
        data: {
          title: "kyra finalizo",
          detail: "git operacion completada"
        }
      });

      return {
        status: "success",
        summary: finalSummary,
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
          title: "kyra encontro un problema",
          detail: "error en la operacion de git"
        }
      });

      return {
        status: "error",
        summary: "Kyra fallo al ejecutar las tareas de git.",
        toolCalls,
        errors: [error instanceof Error ? error.message : String(error)],
        confidence: "low",
        sources: [],
        queriesTried: [],
        visitedUrls: [],
        officialSourceFound: false,
        reasoningSummary: "Ocurrio un error en Kyra."
      };
    } finally {
      await client.close();
    }
  }
}

export { GitAgent as KyraAgent };