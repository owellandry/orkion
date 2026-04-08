import { Command, CommandContext } from "./types.ts";
import { write } from "../ui/layout.ts";
import { theme } from "../ui/theme.ts";
import { c } from "../ui/colors.ts";

export const exitCommand: Command = {
  name: "/exit",
  description: "Exit the REPL",
  execute() {
    write(`${theme.bar}\n${theme.end}  ${c.dim}¡Hasta luego!${c.reset}\n\n`);
    process.exit(0);
  }
};
