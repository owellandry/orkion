import { describe, expect, test } from "bun:test";
import { IntentAgent } from "../src/agents/intent-agent.ts";

describe("IntentAgent", () => {
  test("strips colloquial suffixes from the entity before research", () => {
    const agent = new IntentAgent();

    const result = agent.analyze({
      id: "intent-1",
      goal: "que es vinext amigaso?"
    });

    expect(result.resolvedGoal).toBe("que es vinext");
    expect(result.intent.targetEntity).toBe("vinext");
    expect(result.strippedTokens).toContain("amigaso");
  });

  test("can infer implicit references from recent history", () => {
    const agent = new IntentAgent();

    const result = agent.analyze({
      id: "intent-2",
      goal: "y eso es mejor que next o peor?",
      context: [
        "user: quiero saber que es openvite",
        "assistant: OpenVite es un framework experimental sobre Vite."
      ]
    });

    expect(result.inferredEntityFromHistory).toBe(true);
    expect(result.resolvedGoal.toLowerCase()).toContain("openvite");
  });
});
