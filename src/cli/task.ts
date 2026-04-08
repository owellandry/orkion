import type { CliState } from "./args.ts";
import { createOrkionRuntime } from "../runtime/create-runtime.ts";
import type { TaskRequest, ExecutionEvent } from "../types/agent.ts";
import { ConsoleRenderer } from "./ui/renderer.ts";

export async function executeTask(goal: string, state: CliState): Promise<void> {
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
  const result = await runtime.manager.run(request, (event: ExecutionEvent) => renderer.handle(event));
  renderer.finish(result, state);
}
