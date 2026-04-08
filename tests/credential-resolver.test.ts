import { afterEach, describe, expect, test } from "bun:test";
import { CredentialResolver } from "../src/config/credential-resolver.ts";

const ENV_KEYS = ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY"] as const;

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

describe("CredentialResolver", () => {
  test("loads provider keys from env", () => {
    process.env.OPENROUTER_API_KEY = "router-key";
    process.env.OPENAI_API_KEY = "openai-key";

    const resolver = new CredentialResolver();

    expect(resolver.get("openrouter")).toBe("router-key");
    expect(resolver.get("openai")).toBe("openai-key");
    expect(resolver.has("anthropic")).toBe(false);
  });
});
