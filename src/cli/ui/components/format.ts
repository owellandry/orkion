import type { ExecutionEvent } from "../../../types/agent.ts";
import { c } from "../colors.ts";

export function fallbackPhaseTitle(scope: ExecutionEvent["scope"]): string {
  switch (scope) {
    case "manager":  return "Thinking...";
    case "agent":    return "Agent working...";
    case "mcp":      return ""; 
    case "provider": return "Synthesizing...";
  }
}

export function phaseColor(title: string): string {
  if (title.includes("lyra") || title.includes("kyra") || title.includes("working")) return c.brightMagenta;
  if (title.includes("Synthesiz")) return c.brightBlue;
  return c.brightCyan;
}

export function normalizeStatus(event: ExecutionEvent): { title: string; detail: string } {
  const title  = typeof event.data?.title  === "string" ? event.data.title  : fallbackPhaseTitle(event.scope);
  const detail = typeof event.data?.detail === "string" ? event.data.detail : event.message;
  return { title, detail };
}

export function sourceSummary(domains: string[]): string {
  const counts = new Map<string, number>();
  for (const d of domains) counts.set(d, (counts.get(d) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([d, n]) => (n > 1 ? `${d} ×${n}` : d))
    .join("  ·  ");
}