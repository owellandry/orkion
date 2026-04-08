import { Command, CommandContext } from "./types.ts";
import { printCommandFeedback } from "../ui/welcome.ts";

export const jsonCommand: Command = {
  name: "/json",
  description: "Toggle JSON output mode",
  execute({ state, args }: CommandContext) {
    const arg = args[0] || "";
    state.json = arg.includes("on") || !arg.includes("off");
    printCommandFeedback("json", state.json ? "on" : "off");
  }
};
