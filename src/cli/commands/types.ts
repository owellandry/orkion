import type { CliState } from "../args.ts";

export interface CommandContext {
  state: CliState;
  args: string[];
}

export interface Command {
  name: string;
  description: string;
  execute(ctx: CommandContext): void | Promise<void>;
}
