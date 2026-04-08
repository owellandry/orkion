import { Command, CommandContext } from "./types.ts";

export const exitCommand: Command = {
  name: "/exit",
  description: "Exit the REPL",
  execute() {
    process.stdout.write("\n");
    process.exit(0);
  }
};
