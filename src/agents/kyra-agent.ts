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
  "Nunca pidas confirmacion al usuario a menos que sea una accion destructiva severa.",
  "Cuando el usuario pida commit o push, primero inspecciona el estado real del repo y usa mensajes de commit claros, especificos y profesionales.",
  "Para los commits, utiliza estrictamente Conventional Commits (feat:, fix:, chore:, refactor:, etc.).",
  "El mensaje del commit debe ser corto, imperativo y descriptivo (ej. 'feat: agregar agente de git').",
  "NUNCA incluyas tus instrucciones internas, meta-explicaciones, justificaciones o reflexiones dentro del mensaje del commit o comando git."
].join(" ");

interface GitExecResult {
  success?: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
}

interface RepoSnapshot {
  branch: string;
  tracking?: string;
  aheadCount: number;
  behindCount: number;
  clean: boolean;
  changedFiles: string[];
  rawStatus: string;
}

const COMMIT_PATTERN = /\bcomm?it(?:ear|ea|eando|eado|eados|eadas)?\b/i;

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

function parseGitExec(text: string): GitExecResult {
  try {
    return JSON.parse(text) as GitExecResult;
  } catch {
    return {
      success: false,
      stderr: text,
      error: "Failed to parse git response"
    };
  }
}

function sanitizeCommitMessage(message: string): string {
  return message
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .replace(/"/g, "")
    .trim()
    .slice(0, 72);
}

function isGenericCommitMessage(message: string): boolean {
  const normalized = message.toLowerCase().trim();
  return [
    "update files",
    "update file",
    "misc updates",
    "changes",
    "update",
    "fix stuff",
    "wip"
  ].includes(normalized);
}

function buildFallbackCommitMessage(files: string[], diffStat: string): string {
  const normalizedFiles = files.map((file) => file.replace(/^.*[\\/]/, ""));

  if (normalizedFiles.some((file) => file.includes("kyra") || file.includes("git"))) {
    return "Improve git automation and commit workflow";
  }

  if (normalizedFiles.some((file) => file.includes("intent"))) {
    return "Refine intent handling for task routing";
  }

  if (normalizedFiles.some((file) => file.includes("worker") || file.includes("browser") || file.includes("mcp"))) {
    return "Enhance research agent tooling and MCP flows";
  }

  if (/test/i.test(diffStat) || normalizedFiles.some((file) => file.includes(".test."))) {
    return "Expand coverage for recent runtime changes";
  }

  return "Refine agent runtime behavior";
}

function parseRepoSnapshot(statusOutput: string): RepoSnapshot {
  const lines = statusOutput.split(/\r?\n/).filter(Boolean);
  const header = lines[0] ?? "";
  const branchMatch = header.match(/^## ([^. ]+)(?:\.\.\.([^ ]+))?(?: \[(.+)\])?/);
  const branch = branchMatch?.[1] ?? "HEAD";
  const tracking = branchMatch?.[2];
  const relation = branchMatch?.[3] ?? "";
  const aheadMatch = relation.match(/ahead (\d+)/);
  const behindMatch = relation.match(/behind (\d+)/);
  const changedFiles = lines.slice(1).map((line) => line.slice(3).trim()).filter(Boolean);

  return {
    branch,
    tracking,
    aheadCount: aheadMatch ? Number.parseInt(aheadMatch[1], 10) : 0,
    behindCount: behindMatch ? Number.parseInt(behindMatch[1], 10) : 0,
    clean: changedFiles.length === 0,
    changedFiles,
    rawStatus: statusOutput
  };
}

function wantsCommit(goal: string): boolean {
  return COMMIT_PATTERN.test(goal);
}

function wantsPush(goal: string): boolean {
  return /\bpush\b/i.test(goal);
}

function extractCommitSummary(stdout: string): string {
  const line = stdout.split(/\r?\n/).find(Boolean) ?? stdout;
  const hashMatch = line.match(/\[([^\s]+) ([^\]]+)\]/);
  if (hashMatch) {
    return `${hashMatch[1]} ${hashMatch[2]}`;
  }
  return shortText(line, 120);
}

async function runGitCommand(
  client: McpClientLike,
  toolCalls: ToolCallRecord[],
  command: string
): Promise<GitExecResult> {
  const response = await client.callTool("gitExec", { command });
  toolCalls.push({ toolName: "gitExec", arguments: { command }, resultPreview: shortText(response.text, 140) });
  const parsed = parseGitExec(response.text);
  if (parsed.success === false) {
    throw new Error(parsed.stderr || parsed.error || `Git command failed: ${command}`);
  }
  return parsed;
}

async function generateCommitMessage(
  provider: AgentExecutionContext["provider"],
  plan: DelegationPlan,
  task: TaskRequest,
  snapshot: RepoSnapshot,
  diffNameStatus: string,
  diffStat: string
): Promise<string> {
  if (!provider) {
    return buildFallbackCommitMessage(snapshot.changedFiles, diffStat);
  }

  const response = await provider.generateText({
    model: plan.model,
    temperature: 0.1,
    maxTokens: 80,
    systemPrompt: [
      "You are Kyra, generating a git commit message.",
      "Write one git commit message line only.",
      "Be specific, concise, and professional.",
      "Do not use generic messages like update files or misc changes.",
      "Prefer imperative mood.",
      "Return ONLY the commit message, no quotes, no bullets, no json, no reasoning.",
      "Remember: the commit message MUST be clean and follow conventional commits (feat:, fix:, chore:, refactor:, docs:, style:, test:)."
    ].join(" "),
    prompt: [
      `User request: ${task.goal}`,
      `Branch: ${snapshot.branch}`,
      `Changed files: ${snapshot.changedFiles.join(", ") || "none"}`,
      "Name-status diff:",
      diffNameStatus || "none",
      "Diff stat:",
      diffStat || "none"
    ].join("\n")
  });

  const candidate = sanitizeCommitMessage(response.text);
  if (!candidate || isGenericCommitMessage(candidate)) {
    return buildFallbackCommitMessage(snapshot.changedFiles, diffStat);
  }

  return candidate;
}

export class GitAgent implements SubAgent {
  readonly name = KYRA_AGENT_NAME;
  readonly prompt = KYRA_AGENT_PROMPT;

  constructor(private readonly clientFactory: () => McpClientLike = () => new McpClientAdapter()) {}

  canHandle(task: TaskRequest): boolean {
    return (
      /\bgit\b/i.test(task.goal) ||
      COMMIT_PATTERN.test(task.goal) ||
      /\bpush\b/i.test(task.goal) ||
      /\brama\b/i.test(task.goal) ||
      /\bbranch\b/i.test(task.goal)
    );
  }

  async execute(task: TaskRequest, plan: DelegationPlan, context?: AgentExecutionContext): Promise<AgentTaskResult> {
    const client = this.clientFactory();
    const toolCalls: ToolCallRecord[] = [];

    emit(context, "agent", "Kyra inicializando entorno Git.", {
      title: "kyra esta analizando",
      detail: "inspeccionando estado real del repositorio"
    });

    try {
      const tools = await client.listTools();
      if (!tools.includes("gitExec")) {
        throw new Error("El MCP de git no expone gitExec.");
      }

      emit(context, "mcp", "Leyendo estado del repositorio.", {
        title: "kyra esta analizando",
        detail: "git status --short --branch"
      });
      const status = await runGitCommand(client, toolCalls, "git status --short --branch");
      const snapshot = parseRepoSnapshot(status.stdout ?? "");

      const needsCommit = wantsCommit(task.goal);
      const needsPush = wantsPush(task.goal);

      if (snapshot.clean && !(needsPush && snapshot.aheadCount > 0)) {
        const summary = "No hay cambios pendientes en el arbol de trabajo y no hay commits por subir.";
        context?.observer?.({
          scope: "agent",
          kind: "done",
          message: "Kyra verifico que el repo ya esta al dia.",
          data: {
            title: "kyra finalizo",
            detail: summary
          }
        });

        return {
          status: "success",
          summary,
          toolCalls,
          errors: [],
          confidence: "high",
          sources: [],
          queriesTried: [],
          visitedUrls: [],
          officialSourceFound: true,
          reasoningSummary: summary
        };
      }

      let commitMessage = "";
      let commitSummary = "";
      let pushSummary = "";

      if (!snapshot.clean && needsCommit) {
        emit(context, "mcp", "Preparando cambios para commit.", {
          title: "kyra esta preparando commit",
          detail: `archivos: ${snapshot.changedFiles.length}`
        });
        await runGitCommand(client, toolCalls, "git add -A");

        const diffNameStatus = await runGitCommand(client, toolCalls, "git diff --cached --name-status");
        const diffStat = await runGitCommand(client, toolCalls, "git diff --cached --stat");

        emit(context, "agent", "Redactando mensaje de commit.", {
          title: "kyra esta redactando",
          detail: "generando un mensaje claro a partir del diff"
        });
        commitMessage = await generateCommitMessage(
          context?.provider,
          plan,
          task,
          snapshot,
          diffNameStatus.stdout ?? "",
          diffStat.stdout ?? ""
        );

        emit(context, "mcp", `Creando commit: ${commitMessage}`, {
          title: "kyra esta ejecutando",
          detail: shortText(commitMessage)
        });
        const commitResult = await runGitCommand(client, toolCalls, `git commit -m "${commitMessage}"`);
        commitSummary = extractCommitSummary(commitResult.stdout ?? "");
      }

      if (needsPush) {
        emit(context, "mcp", "Subiendo rama actual al remoto.", {
          title: "kyra esta ejecutando",
          detail: `git push -u origin HEAD`
        });
        const pushResult = await runGitCommand(client, toolCalls, "git push -u origin HEAD");
        pushSummary = shortText(pushResult.stdout || pushResult.stderr || "push completado", 140);
      }

      const finalSummaryParts = [
        commitMessage ? `Commit creado: ${commitMessage}.` : "",
        commitSummary ? `Resultado del commit: ${commitSummary}.` : "",
        pushSummary ? `Push realizado: ${pushSummary}.` : "",
        !needsPush && !needsCommit ? "Kyra inspecciono el estado del repo y no realizo cambios." : ""
      ].filter(Boolean);

      const finalSummary = finalSummaryParts.join(" ");

      context?.observer?.({
        scope: "agent",
        kind: "done",
        message: "Kyra termino las operaciones de git.",
        data: {
          title: "kyra finalizo",
          detail: shortText(finalSummary, 120)
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
