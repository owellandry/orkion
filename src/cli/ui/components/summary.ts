import type { ExecutionEvent, ManagerExecutionResult } from "../../../types/agent.ts";
import { c } from "../colors.ts";
import { write } from "../layout.ts";
import { sourceSummary } from "./format.ts";
import { theme } from "../theme.ts";

export function printVerboseEvent(event: ExecutionEvent): void {
  const scopeColors: Record<string, string> = { manager: c.cyan, agent: c.magenta, mcp: c.yellow, provider: c.blue };
  const scopeNames: Record<string, string> = { manager: "manager", agent: "agent", mcp: "mcp", provider: "model" };
  const icon = event.kind === "done" ? theme.success : event.kind === "error" ? theme.error : theme.bullet;
  const color = scopeColors[event.scope] ?? c.gray;
  const name  = (scopeNames[event.scope] ?? event.scope).padEnd(7);

  write(`  ${icon} ${c.bold}${color}${name}${c.reset}  ${c.dim}${event.message}${c.reset}\n`);
}

export function printSummary(result: ManagerExecutionResult): void {
  const workerStatus = result.workerResult?.status;
  const confidence   = result.workerResult?.confidence;
  const toolCount    = result.workerResult?.toolCalls.length ?? 0;
  const domains      = result.workerResult?.sources.map((s) => s.domain) ?? [];

  const statusBadge = workerStatus === "success" ? `${theme.success} ${c.brightGreen}éxito${c.reset}` : workerStatus === "error" ? `${theme.error} ${c.brightRed}error${c.reset}` : "";
  const confidenceBadge = confidence === "high" ? `${c.brightGreen}alta${c.reset}` : confidence === "medium" ? `${c.brightYellow}media${c.reset}` : confidence === "low" ? `${c.yellow}baja${c.reset}` : "";
  const sep = `  ${c.gray}·${c.reset}  `;

  const parts: string[] = [ `${c.gray}${result.plan.provider}${c.reset}`, `${c.dim}${result.plan.model}${c.reset}` ];
  if (toolCount > 0) parts.push(`${c.gray}${toolCount} herr.${c.reset}`);
  if (statusBadge) parts.push(statusBadge);
  if (confidenceBadge) parts.push(`confianza ${confidenceBadge}`);
  if (result.plan.warnings.length > 0) parts.push(`${c.yellow}⚠ ${result.plan.warnings.join(" · ")}${c.reset}`);

  write(`\n  ${parts.join(sep).trim()}\n`);

  if (domains.length > 0 && confidence !== "high") {
    write(`  ${theme.bullet} ${c.gray}fuentes${c.reset}  ${c.dim}${sourceSummary(domains)}${c.reset}\n`);
  }
}
