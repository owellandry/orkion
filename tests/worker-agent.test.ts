import { describe, expect, test } from "bun:test";
import { LYRA_AGENT_NAME, LYRA_AGENT_PROMPT, WorkerAgent } from "../src/agents/worker-agent.ts";
import type { McpClientLike } from "../src/mcp/client-adapter.ts";
import type { DelegationPlan, TaskRequest } from "../src/types/agent.ts";
import type { GenerateTextRequest, GenerateTextResult, LLMProvider } from "../src/providers/types.ts";

const plan: DelegationPlan = {
  selectedAgent: LYRA_AGENT_NAME,
  instructions: "Use tools.",
  expectedOutput: "Summary",
  shouldDelegate: true,
  provider: "openrouter",
  model: "meta-llama/llama-3.3-8b-instruct:free",
  fallbackUsed: false,
  warnings: [],
  intentType: "general_research",
  researchRequired: true,
  researchBudget: {
    maxRounds: 3,
    maxVisitedUrls: 6,
    maxReformulations: 2,
    maxSearchQueriesPerRound: 2,
    maxPagesPerRound: 2
  }
};

class FakeProvider implements LLMProvider {
  readonly name = "openrouter" as const;
  readonly capabilities = {
    supportsTools: false,
    supportsStructuredOutput: false
  };

  isConfigured(): boolean {
    return true;
  }

  async generateText(_request: GenerateTextRequest): Promise<GenerateTextResult> {
    return {
      text: "vinext cloudflare framework official\nvinext docs\nvinext github"
    };
  }

  async streamText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    const text = "fake stream";
    request.onToken?.(text);
    return { text };
  }
}

describe("WorkerAgent", () => {
  test("executes an MCP-backed task successfully", async () => {
    const worker = new WorkerAgent();
    const task: TaskRequest = {
      id: "task-1",
      goal: "Busca informacion sobre MCP y luego crea un reporte corto",
      outputFormat: "text"
    };

    const result = await worker.execute(task, plan);

    expect(result.status).toBe("success");
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(2);
    expect(result.summary).toContain("Lyra Research Report");
    expect(result.data?.agentName).toBe(LYRA_AGENT_NAME);
    expect(result.data?.prompt).toBe(LYRA_AGENT_PROMPT);
  });

  test("persists across rounds and reformulates when the first query is weak", async () => {
    const responses = new Map<string, string>([
      ["searchWeb:vinext cloudflare", JSON.stringify({ query: "vinext cloudflare", results: [] })],
      [
        "searchWeb:vinext cloudflare framework official",
        JSON.stringify({
          query: "vinext cloudflare framework official",
          results: [{ title: "Vinext", url: "https://vinext.io/" }]
        })
      ],
      [
        "fetchWebPage:https://vinext.io/",
        JSON.stringify({ url: "https://vinext.io/", preview: "Vinext is a reimplementation of the Next.js API surface on top of Vite." })
      ],
      [
        "extractLinksFromPage:https://vinext.io/",
        JSON.stringify({
          url: "https://vinext.io/",
          links: [{ url: "https://vinext.io/docs/getting-started", text: "Getting started" }]
        })
      ],
      [
        "fetchWebPage:https://vinext.io/docs/getting-started",
        JSON.stringify({ url: "https://vinext.io/docs/getting-started", preview: "Deploy to Cloudflare Workers with a drop-in Next.js compatible runtime." })
      ],
      [
        "fetchRobotsOrSitemap:https://vinext.io/",
        JSON.stringify({ url: "https://vinext.io/", robotsPreview: "Sitemap: https://vinext.io/sitemap.xml", sitemapPreview: "" })
      ],
      [
        "formatReport:Lyra Research Report",
        "# Lyra Research Report\n\nVinext is a reimplementation of the Next.js API surface on top of Vite."
      ]
    ]);

    const fakeClient: McpClientLike = {
      async listTools() {
        return ["searchWeb", "fetchWebPage", "extractLinksFromPage", "fetchRobotsOrSitemap", "formatReport"];
      },
      async callTool(name, args) {
        const key =
          name === "formatReport"
            ? `${name}:${String(args.title)}`
            : name === "searchWeb"
              ? `${name}:${String(args.query)}`
              : `${name}:${String(args.url)}`;
        const text = responses.get(key) ?? JSON.stringify({ results: [] });
        return { text, raw: text };
      },
      async close() {
        return;
      }
    };

    const worker = new WorkerAgent(() => fakeClient);
    const result = await worker.execute(
      {
        id: "task-persist",
        goal: "quiero saber que es vinext, el framework de cloudflare"
      },
      plan,
      {
        provider: new FakeProvider()
      }
    );

    expect(result.status).toBe("success");
    expect(result.queriesTried.length).toBeGreaterThanOrEqual(2);
    expect(result.visitedUrls).toContain("https://vinext.io/");
    expect(result.officialSourceFound).toBe(true);
    expect(result.confidence === "high" || result.confidence === "medium").toBe(true);
  });
});
