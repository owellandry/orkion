import { expect, test, describe } from "bun:test";
import { KyraAgent } from "../src/agents/kyra-agent.ts";
import type { TaskRequest } from "../src/types/agent.ts";

describe("KyraAgent", () => {
  test("canHandle detects git operations correctly", () => {
    const kyra = new KyraAgent(() => ({} as any));

    expect(kyra.canHandle({ goal: "crea un commit" } as TaskRequest)).toBe(true);
    expect(kyra.canHandle({ goal: "haz un push a origin main" } as TaskRequest)).toBe(true);
    expect(kyra.canHandle({ goal: "revisa el status de git" } as TaskRequest)).toBe(true);
    expect(kyra.canHandle({ goal: "creame una nueva rama feature-1" } as TaskRequest)).toBe(true);
    
    expect(kyra.canHandle({ goal: "quien es el presidente de francia" } as TaskRequest)).toBe(false);
    expect(kyra.canHandle({ goal: "calcula 2 + 2" } as TaskRequest)).toBe(false);
  });
});
