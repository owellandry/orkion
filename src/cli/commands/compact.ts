import { Command, CommandContext } from "./types.ts";
import { buildCompactSummary } from "../context-memory.ts";
import { printCommandFeedback } from "../ui/welcome.ts";

export const compactCommand: Command = {
  name: "/compact",
  description: "Compact the conversation into a short summary",
  execute({ state }: CommandContext) {
    if (state.history.length === 0 && !state.compactSummary) {
      printCommandFeedback("compact", "no hay conversacion para compactar");
      return;
    }

    state.compactSummary = buildCompactSummary(state.history, state.compactSummary);
    state.history = state.history.slice(-2);
    printCommandFeedback("compact", "conversacion compactada y preservada como contexto");
  }
};
