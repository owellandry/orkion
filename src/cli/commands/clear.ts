import { Command, CommandContext } from "./types.ts";
import { clearScreen } from "../ui/layout.ts";
import { printWelcome, printCommandFeedback } from "../ui/welcome.ts";

export const clearCommand: Command = {
  name: "/clear",
  description: "Clear the current chat context",
  execute({ state }: CommandContext) {
    state.history = [];
    state.compactSummary = undefined;
    state.permissionStore?.resetSession();
    clearScreen();
    printWelcome();
    printCommandFeedback("chat", "contexto reiniciado");
  }
};
