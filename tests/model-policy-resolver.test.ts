import { afterEach, describe, expect, test } from "bun:test";
import type { OrkionConfig } from "../src/config/types.ts";
import { CredentialResolver } from "../src/config/credential-resolver.ts";
import { OrkionConfigurationError } from "../src/errors/configuration-error.ts";
import { ModelPolicyResolver } from "../src/providers/model-policy-resolver.ts";
import { ProviderRegistry } from "../src/providers/provider-registry.ts";

const baseConfig: OrkionConfig = {
  defaultProvider: "openrouter",
  providerPriority: ["openrouter", "openai", "anthropic", "xai", "groq"],
  providers: {
    openrouter: {
      enabled: true,
      defaultModel: "meta-llama/llama-3.3-8b-instruct:free",
      fallbackModel: "meta-llama/llama-3.3-8b-instruct:free",
      preferFreeModels: true
    },
    openai: {
      enabled: true,
      defaultModel: "gpt-4.1-mini",
      fallbackModel: "gpt-4.1-mini"
    },
    anthropic: {
      enabled: true,
      defaultModel: "claude-3-5-sonnet-latest",
      fallbackModel: "claude-3-5-haiku-latest"
    },
    xai: {
      enabled: true,
      defaultModel: "grok-3-mini",
      fallbackModel: "grok-3-mini"
    },
    groq: {
      enabled: true,
      defaultModel: "llama-3.3-70b-versatile",
      fallbackModel: "llama-3.1-8b-instant"
    }
  }
};

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GROQ_API_KEY;
  process.env.OPENROUTER_MODEL = "";
  process.env.GROQ_MODEL = "";
});

function createResolver(config: OrkionConfig = baseConfig): ModelPolicyResolver {
  const credentials = new CredentialResolver();
  const registry = new ProviderRegistry(config, credentials);
  return new ModelPolicyResolver(config, registry);
}

describe("ModelPolicyResolver", () => {
  test("selects OpenRouter free model by default", () => {
    process.env.OPENROUTER_API_KEY = "router-key";
    process.env.OPENROUTER_MODEL = "";
    const resolver = createResolver();

    const selection = resolver.resolve();

    expect(selection.provider).toBe("openrouter");
    expect(selection.model).toBe("meta-llama/llama-3.3-8b-instruct:free");
  });

  test("respects explicit provider and model when available", () => {
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.OPENROUTER_MODEL = "";
    const resolver = createResolver();

    const selection = resolver.resolve({
      preferredProvider: "openai",
      preferredModel: "gpt-4.1"
    });

    expect(selection.provider).toBe("openai");
    expect(selection.model).toBe("gpt-4.1");
  });

  test("falls back to next available provider when default has no key", () => {
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.OPENROUTER_MODEL = "";
    const resolver = createResolver();

    const selection = resolver.resolve();

    expect(selection.provider).toBe("openai");
    expect(selection.fallbackUsed).toBe(true);
  });

  test("selects Groq when it is the available fallback provider", () => {
    process.env.GROQ_API_KEY = "groq-key";
    process.env.GROQ_MODEL = "";
    const resolver = createResolver();

    const selection = resolver.resolve();

    expect(selection.provider).toBe("groq");
    expect(selection.model).toBe("llama-3.3-70b-versatile");
    expect(selection.fallbackUsed).toBe(true);
  });

  test("respects GROQ_MODEL env override", () => {
    process.env.GROQ_API_KEY = "groq-key";
    process.env.GROQ_MODEL = "openai/gpt-oss-20b";
    const resolver = createResolver();

    const selection = resolver.resolve({
      preferredProvider: "groq"
    });

    expect(selection.provider).toBe("groq");
    expect(selection.model).toBe("openai/gpt-oss-20b");
  });

  test("throws a clear error when no provider credentials are available", () => {
    const resolver = createResolver();

    expect(() => resolver.resolve()).toThrow(OrkionConfigurationError);
  });
});
