import { Command, CommandContext } from "./types.ts";
import { printCommandFeedback } from "../ui/welcome.ts";

export const modelCommand: Command = {
  name: "/model",
  description: "Set the model",
  execute({ state, args }: CommandContext) {
    if (args.length > 0) {
      state.model = args.join(" ");
      printCommandFeedback("model", state.model);
    }
  }
};
