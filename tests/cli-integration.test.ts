import { describe, expect, test } from "bun:test";
import type { OrkionConfig } from "../src/config/types.ts";
import { createOrkionRuntime } from "../src/runtime/create-runtime.ts";
import type { GenerateTextRequest, GenerateTextResult, LLMProvider } from "../src/providers/types.ts";
import type { ProviderFactory } from "../src/providers/provider-registry.ts";

class IntegrationFakeProvider implements LLMProvider {
  readonly name = "openrouter" as const;
  readonly capabilities = {
    supportsTools: false,
    supportsStructuredOutput: false
  };

  isConfigured(): boolean {
    return true;
  }

  async generateText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    return {
      text: `CLI_OK ${request.model} ${request.prompt.includes("subagente") ? "delegated" : "direct"}`
    };
  }

  async streamText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    const text = `CLI_OK ${request.model} ${request.prompt.includes("subagente") ? "delegated" : "direct"}`;
    request.onToken?.(text);
    return { text };
  }
}

const fakeFactory: ProviderFactory = () => new IntegrationFakeProvider();

const config: OrkionConfig = {
  defaultProvider: "openrouter",
  providerPriority: ["openrouter", "openai", "anthropic", "xai"],
  providers: {
    openrouter: {
      enabled: true,
      defaultModel: "meta-llama/llama-3.3-8b-instruct:free",
      fallbackModel: "meta-llama/llama-3.3-8b-instruct:free",
      preferFreeModels: true
    },
    openai: {
      enabled: false,
      defaultModel: "gpt-4.1-mini",
      fallbackModel: "gpt-4.1-mini"
    },
    anthropic: {
      enabled: false,
      defaultModel: "claude-3-5-sonnet-latest",
      fallbackModel: "claude-3-5-haiku-latest"
    },
    xai: {
      enabled: false,
      defaultModel: "grok-3-mini",
      fallbackModel: "grok-3-mini"
    }
  }
};

describe("CLI integration", () => {
  test("runs end-to-end with a real worker and fake provider", async () => {
    process.env.OPENROUTER_API_KEY = "router-key";

    const runtime = createOrkionRuntime({
      config,
      providerFactory: fakeFactory
    });

    const result = await runtime.manager.run({
      id: "task-4",
      goal: "Busca informacion sobre MCP y arma un reporte para el manager"
    });

    expect(result.delegated).toBe(true);
    expect(result.workerResult?.status).toBe("success");
    expect(result.text).toContain("CLI_OK");

    delete process.env.OPENROUTER_API_KEY;
  });
});
