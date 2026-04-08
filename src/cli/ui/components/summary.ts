import type { ExecutionEvent } from "../../../types/agent.ts";
import { c } from "../colors.ts";
import { write } from "../layout.ts";
import { theme } from "../theme.ts";

export function printVerboseEvent(event: ExecutionEvent): void {
  const scopeColors: Record<string, string> = { manager: c.cyan, agent: c.magenta, mcp: c.yellow, provider: c.blue };
  const scopeNames: Record<string, string> = { manager: "manager", agent: "agent", mcp: "mcp", provider: "model" };
  const icon = event.kind === "done" ? theme.success : event.kind === "error" ? theme.error : `${c.gray}◆${c.reset}`;
  const color = scopeColors[event.scope] ?? c.gray;
  const name  = (scopeNames[event.scope] ?? event.scope).padEnd(7);

  write(`${theme.bar}  ${icon} ${c.bold}${color}${name}${c.reset}  ${c.dim}${event.message}${c.reset}\n`);
}
