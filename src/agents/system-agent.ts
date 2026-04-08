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
  "Tienes contexto total del sistema operativo y acceso para ejecutar comandos de consola (bash, cmd, powershell, etc).",
  "Puedes crear archivos, directorios, listar procesos, o hacer operaciones a nivel de sistema.",
  "Ten cuidado con comandos destructivos (rm -rf, format, etc) y NUNCA pidas confirmación a menos que el comando pueda dañar permanentemente el sistema.",
  "Piensa paso a paso y usa comandos de consola para cumplir con la petición del usuario."
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

export class SystemAgent implements SubAgent {
  readonly name = SYSTEM_AGENT_NAME;
  readonly prompt = SYSTEM_AGENT_PROMPT;

  constructor(private readonly clientFactory: () => McpClientLike) {}

  canHandle(task: TaskRequest): boolean {
    return task.intentHint === "system_operation" || 
           /\b(comando|consola|terminal|bash|shell|sistema|carpeta|directorio|archivo|file)\b/i.test(task.goal);
  }

  async execute(task: TaskRequest, plan: DelegationPlan, context?: AgentExecutionContext): Promise<AgentTaskResult> {
    const client = this.clientFactory();
    const toolCalls: ToolCallRecord[] = [];
    const evidence: string[] = [];
    
    emit(context, "agent", "System inicializando contexto del sistema.", {
      title: "system está analizando",
      detail: `objetivo: operaciones de sistema`
    });

    try {
      emit(context, "mcp", "Conectando con MCP de Sistema.", {
        title: "preparando shell",
        detail: "mcp del sistema listo"
      });
      
      const tools = await client.listTools();
      
      if (tools.includes("getOsContext")) {
        const response = await client.callTool("getOsContext", {});
        toolCalls.push({ toolName: "getOsContext", arguments: {}, resultPreview: "OS context retrieved" });
        evidence.push(`OS Context: ${response.text}`);
      }

      if (!context?.provider) {
        throw new Error("Se requiere un LLMProvider para el agente System.");
      }

      let currentRound = 0;
      const maxRounds = 8;
      let finalSummary = "Operación de sistema completada con éxito.";

      let currentPrompt = `Goal: ${task.goal}\nContext:\n${evidence.join("\n")}\nWhat shell command should we run first? Return ONLY a valid JSON object with {"command": "echo hello"} or {"done": true, "summary": "what was done"}.`;

      while (currentRound < maxRounds) {
        currentRound++;
        
        const response = await context.provider.generateText({
          model: plan.model,
          temperature: 0.1,
          systemPrompt: this.prompt + " Always respond in strict JSON format: {\"command\": \"<cmd>\"} OR {\"done\": true, \"summary\": \"final summary\"}.",
          prompt: currentPrompt
        });

        const raw = response.text.trim().replace(/```json/gi, "").replace(/```/g, "").trim();
        
        let action: any;
        try {
          action = JSON.parse(raw);
        } catch (err) {
          emit(context, "agent", "El modelo falló al responder JSON, reintentando...", {
            title: "system pensando",
            detail: "error de formato JSON"
          });
          currentPrompt += `\nError: Please respond in strict JSON format. You gave: ${raw}`;
          continue;
        }

        if (action.done) {
          finalSummary = action.summary || "Tareas de sistema completadas.";
          break;
        }

        if (action.command) {
          emit(context, "mcp", `Ejecutando: ${action.command}`, {
            title: "system está ejecutando",
            detail: shortText(action.command)
          });

          const mcpResponse = await client.callTool("runCommand", { command: action.command });
          toolCalls.push({ toolName: "runCommand", arguments: { command: action.command }, resultPreview: shortText(mcpResponse.text) });
          
          evidence.push(`Command: ${action.command}\nResult: ${mcpResponse.text}`);
          
          currentPrompt = `Goal: ${task.goal}\nLast execution:\n${action.command}\nResult:\n${mcpResponse.text}\n\nWhat is the next step? Return ONLY JSON {"command": "..."} or {"done": true, "summary": "..."}`;
        }
      }

      context?.observer?.({
        scope: "agent",
        kind: "done",
        message: "System terminó las operaciones de sistema.",
        data: {
          title: "system finalizó",
          detail: "operación de consola completada"
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
          title: "system encontró un problema",
          detail: "error en la operación de sistema"
        }
      });

      return {
        status: "error",
        summary: "System falló al ejecutar comandos en el shell.",
        toolCalls,
        errors: [error instanceof Error ? error.message : String(error)],
        confidence: "low",
        sources: [],
        queriesTried: [],
        visitedUrls: [],
        officialSourceFound: false,
        reasoningSummary: "Ocurrió un error en System."
      };
    } finally {
      await client.close();
    }
  }
}
