import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { CliState } from "./args.ts";
import { printWelcome } from "./ui/welcome.ts";
import { executeTask } from "./task.ts";
import { findCommand } from "./commands/index.ts";
import { c } from "./ui/colors.ts";
import { theme } from "./ui/theme.ts";
import { createPermissionPrompter } from "./permissions.ts";

export async function runInteractive(state: CliState): Promise<void> {
  const rl = createInterface({ input, output });
  state.permissionPrompter = createPermissionPrompter(rl);

  printWelcome();

  try {
    while (true) {
      const line = (await rl.question(`${theme.bar}\n${theme.step}  ${c.bold}¿Qué te gustaría hacer?${c.reset}\n${theme.bar}  ${theme.arrow} `)).trim();
      if (!line) {
        continue;
      }

      const commandMatch = findCommand(line);
      if (commandMatch) {
        const { command, args } = commandMatch;
        await command.execute({ state, args });
        continue;
      }

      await executeTask(line, state);
    }
  } finally {
    rl.close();
  }
}
