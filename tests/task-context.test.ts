import { describe, expect, test } from "bun:test";
import type { CliState } from "../src/cli/args.ts";
import { buildConversationContext } from "../src/cli/task.ts";

describe("task context", () => {
  test("includes compact summary before recent history", () => {
    const state: CliState = {
      json: false,
      verbose: false,
      historyLimit: 4,
      compactSummary: "El usuario esta comparando frameworks frontend.",
      history: [
        { role: "user", content: "que es vinext?" },
        { role: "assistant", content: "Vinext reimplementa la API de Next.js sobre Vite." }
      ]
    };

    expect(buildConversationContext(state)).toEqual([
      "system: Resumen compacto de la conversacion previa: El usuario esta comparando frameworks frontend.",
      "user: que es vinext?",
      "assistant: Vinext reimplementa la API de Next.js sobre Vite."
    ]);
  });
});
