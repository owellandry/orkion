import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { ProviderName } from "../config/types.ts";
import { OrkionConfigurationError } from "../errors/configuration-error.ts";
import { createOrkionRuntime } from "../runtime/create-runtime.ts";
import type { TaskRequest } from "../types/agent.ts";
import { parseArgs, type CliState } from "./args.ts";
import { ConsoleRenderer, printWelcome, printCommandFeedback } from "./renderer.ts";

async function executeTask(goal: string, state: CliState): Promise<void> {
  const runtime = createOrkionRuntime();
  const request: TaskRequest = {
    id: crypto.randomUUID(),
    goal,
    preferredProvider: state.provider,
    preferredModel: state.model,
    outputFormat: state.json ? "json" : "text"
  };

  const renderer = new ConsoleRenderer(state.verbose);
  renderer.beginTask(goal);
  const result = await runtime.manager.run(request, (event) => renderer.handle(event));
  renderer.finish(result, state);
}

async function runInteractive(state: CliState): Promise<void> {
  const rl = createInterface({ input, output });

  printWelcome();

  try {
    while (true) {
      const line = (await rl.question("> ")).trim();
      if (!line) {
        continue;
      }

      if (line === "/exit") {
        process.stdout.write("\n");
        break;
      }

      if (line.startsWith("/provider ")) {
        state.provider = line.replace("/provider ", "").trim() as ProviderName;
        printCommandFeedback("provider", state.provider);
        continue;
      }

      if (line.startsWith("/model ")) {
        state.model = line.replace("/model ", "").trim();
        printCommandFeedback("model", state.model);
        continue;
      }

      if (line.startsWith("/json")) {
        state.json = line.includes("on") || !line.includes("off");
        printCommandFeedback("json", state.json ? "on" : "off");
        continue;
      }

      if (line.startsWith("/verbose")) {
        state.verbose = line.includes("on") || !line.includes("off");
        printCommandFeedback("verbose", state.verbose ? "on" : "off");
        continue;
      }

      await executeTask(line, state);
    }
  } finally {
    rl.close();
  }
}

export async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.task) {
    await executeTask(parsed.task, parsed.state);
    return;
  }

  await runInteractive(parsed.state);
}

export function handleCliError(error: unknown): never {
  if (error instanceof OrkionConfigurationError) {
    process.stderr.write(`\n  \x1b[91m✗\x1b[0m  \x1b[1mconfiguration error\x1b[0m  \x1b[2m${error.message}\x1b[0m\n\n`);
    process.exit(1);
  }

  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\n  \x1b[91m✗\x1b[0m  \x1b[1mfatal error\x1b[0m  \x1b[2m${msg}\x1b[0m\n\n`);
  process.exit(1);
}
