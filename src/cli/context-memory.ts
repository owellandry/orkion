import type { ConversationTurn } from "./args.ts";

function collapseText(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

export function buildCompactSummary(history: ConversationTurn[], previousSummary?: string): string {
  const recentTurns = history.slice(-10);
  const userTurns = recentTurns.filter((turn) => turn.role === "user").map((turn) => collapseText(turn.content, 160));
  const assistantTurns = recentTurns
    .filter((turn) => turn.role === "assistant")
    .map((turn) => collapseText(turn.content, 180));

  const segments = [
    previousSummary ? `Resumen previo: ${collapseText(previousSummary, 320)}` : "",
    userTurns.length > 0 ? `Objetivos recientes: ${userTurns.join(" | ")}` : "",
    assistantTurns.length > 0 ? `Respuestas recientes: ${assistantTurns.join(" | ")}` : ""
  ].filter(Boolean);

  return collapseText(segments.join(" "), 900);
}
