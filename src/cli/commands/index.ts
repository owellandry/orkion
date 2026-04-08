import { providerCommand } from "./provider.ts";
import { modelCommand } from "./model.ts";
import { jsonCommand } from "./json.ts";
import { verboseCommand } from "./verbose.ts";
import { exitCommand } from "./exit.ts";
import { clearCommand } from "./clear.ts";
import { compactCommand } from "./compact.ts";
import { Command } from "./types.ts";

export const commands: Command[] = [
  providerCommand,
  modelCommand,
  jsonCommand,
  verboseCommand,
  clearCommand,
  compactCommand,
  exitCommand
];

export function findCommand(line: string): { command: Command; args: string[] } | undefined {
  const parts = line.trim().split(" ");
  const name = parts[0];
  const command = commands.find((cmd) => cmd.name === name);
  if (command) {
    return { command, args: parts.slice(1) };
  }
  return undefined;
}
