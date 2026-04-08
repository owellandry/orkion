import type { CliState } from "./args.ts";
import { createOrkionRuntime } from "../runtime/create-runtime.ts";
import type { TaskRequest, ExecutionEvent } from "../types/agent.ts";
import { ConsoleRenderer } from "./ui/renderer.ts";

function buildConversationContext(state: CliState): string[] {
  return state.history
    .slice(-state.historyLimit)
    .map((turn) => `${turn.role}: ${turn.content}`);
}

function rememberTurn(state: CliState, role: "user" | "assistant", content: string): void {
  state.history.push({ role, content });
  const maxEntries = state.historyLimit * 2;
  if (state.history.length > maxEntries) {
    state.history.splice(0, state.history.length - maxEntries);
  }
}

export async function executeTask(goal: string, state: CliState): Promise<void> {
  const runtime = createOrkionRuntime();
  const request: TaskRequest = {
    id: crypto.randomUUID(),
    goal,
    context: buildConversationContext(state),
    preferredProvider: state.provider,
    preferredModel: state.model,
    outputFormat: state.json ? "json" : "text"
  };

  const renderer = new ConsoleRenderer(state.verbose);
  renderer.beginTask(goal);
  const result = await runtime.manager.run(request, (event: ExecutionEvent) => renderer.handle(event));
  renderer.finish(result, state);

  rememberTurn(state, "user", goal);
  rememberTurn(state, "assistant", result.text.trim());
}
