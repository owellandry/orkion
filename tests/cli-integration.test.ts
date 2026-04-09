import { describe, expect, test } from "bun:test";
import type { OrkionConfig } from "../src/config/types.ts";
import type { McpClientLike } from "../src/mcp/client-adapter.ts";
import type { ProviderFactory } from "../src/providers/provider-registry.ts";
import type { GenerateTextRequest, GenerateTextResult, LLMProvider } from "../src/providers/types.ts";
import { createOrkionRuntime } from "../src/runtime/create-runtime.ts";

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
  providerPriority: ["openrouter", "openai", "anthropic", "xai", "groq"],
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
    },
    groq: {
      enabled: false,
      defaultModel: "llama-3.3-70b-versatile",
      fallbackModel: "llama-3.1-8b-instant"
    }
  }
};

function createFakeMcpClient(): McpClientLike {
  const responses: Record<string, string> = {
    "searchKnowledge:Busca informacion sobre MCP y arma un reporte para el manager": JSON.stringify({
      query: "Busca informacion sobre MCP y arma un reporte para el manager",
      results: [{ topic: "mcp", text: "MCP connects models to tools and resources." }]
    }),
    "searchWeb:Busca informacion sobre MCP y arma un reporte para el manager": JSON.stringify({
      query: "Busca informacion sobre MCP y arma un reporte para el manager",
      results: [{ title: "MCP Docs", url: "https://modelcontextprotocol.io/docs" }]
    }),
    "fetchWebPage:https://modelcontextprotocol.io/docs": JSON.stringify({
      url: "https://modelcontextprotocol.io/docs",
      preview: "The Model Context Protocol provides a standard way to connect models to tools and resources."
    }),
    "extractLinksFromPage:https://modelcontextprotocol.io/docs": JSON.stringify({ url: "https://modelcontextprotocol.io/docs", links: [] }),
    "fetchRobotsOrSitemap:https://modelcontextprotocol.io/docs": JSON.stringify({ url: "https://modelcontextprotocol.io/docs", robotsPreview: "", sitemapPreview: "" }),
    "formatReport:Lyra Research Report":
      "# Lyra Research Report\n\nThe Model Context Protocol provides a standard way to connect models to tools and resources."
  };

  return {
    async listTools() {
      return ["searchKnowledge", "searchWeb", "fetchWebPage", "extractLinksFromPage", "fetchRobotsOrSitemap", "formatReport"];
    },
    async callTool(name, args) {
      const key =
        name === "formatReport"
          ? `${name}:${String(args.title)}`
          : name === "searchKnowledge"
            ? `${name}:${String(args.query)}`
            : name === "searchWeb"
              ? `${name}:${String(args.query)}`
              : `${name}:${String(args.url)}`;

      return {
        text: responses[key] ?? JSON.stringify({ results: [] }),
        raw: ""
      };
    },
    async close() {
      return;
    }
  };
}

describe("CLI integration", () => {
  test("runs end-to-end with a fake provider and deterministic research data", async () => {
    process.env.OPENROUTER_API_KEY = "router-key";

    const runtime = createOrkionRuntime({
      config,
      providerFactory: fakeFactory,
      mcpClientFactory: () => createFakeMcpClient()
    });

    const result = await runtime.manager.run({
      id: "task-4",
      goal: "Busca informacion sobre MCP y arma un reporte para el manager"
    });

    expect(result.delegated).toBe(true);
    expect(result.workerResult?.status).toBe("success");
    expect(result.workerResult?.confidence === "high" || result.workerResult?.confidence === "medium").toBe(true);
    expect(result.text).toContain("CLI_OK");

    delete process.env.OPENROUTER_API_KEY;
  });
});
