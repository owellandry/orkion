import { Command, CommandContext } from "./types.ts";
import { printCommandFeedback } from "../ui/welcome.ts";
import type { ProviderName } from "../../config/types.ts";

export const providerCommand: Command = {
  name: "/provider",
  description: "Set the provider",
  execute({ state, args }: CommandContext) {
    if (args.length > 0) {
      state.provider = args[0] as ProviderName;
      printCommandFeedback("provider", state.provider);
    }
  }
};
