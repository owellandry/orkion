import type { ProviderName } from "../config/types.ts";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface CliState {
  provider?: ProviderName;
  model?: string;
  json: boolean;
  verbose: boolean;
  history: ConversationTurn[];
  historyLimit: number;
}

export function parseArgs(argv: string[]): { task?: string; state: CliState } {
  const state: CliState = {
    json: false,
    verbose: false,
    history: [],
    historyLimit: 6
  };
  const taskParts: string[] = [];

  for (const arg of argv) {
    if (arg.startsWith("--provider=")) {
      state.provider = arg.split("=")[1] as ProviderName;
      continue;
    }

    if (arg.startsWith("--model=")) {
      state.model = arg.split("=")[1];
      continue;
    }

    if (arg === "--json") {
      state.json = true;
      continue;
    }

    if (arg === "--verbose") {
      state.verbose = true;
      continue;
    }

    taskParts.push(arg);
  }

  return {
    task: taskParts.length > 0 ? taskParts.join(" ") : undefined,
    state
  };
}
