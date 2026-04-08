import { Command, CommandContext } from "./types.ts";
import { printCommandFeedback } from "../ui/welcome.ts";

export const verboseCommand: Command = {
  name: "/verbose",
  description: "Toggle verbose output",
  execute({ state, args }: CommandContext) {
    const arg = args[0] || "";
    state.verbose = arg.includes("on") || !arg.includes("off");
    printCommandFeedback("verbose", state.verbose ? "on" : "off");
  }
};
