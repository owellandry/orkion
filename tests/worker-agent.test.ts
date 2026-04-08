import { describe, expect, test } from "bun:test";
import { LYRA_AGENT_NAME, LYRA_AGENT_PROMPT, WorkerAgent } from "../src/agents/worker-agent.ts";
import type { McpClientLike } from "../src/mcp/client-adapter.ts";
import type { GenerateTextRequest, GenerateTextResult, LLMProvider } from "../src/providers/types.ts";
import type { DelegationPlan, TaskRequest } from "../src/types/agent.ts";

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

function createFakeClient(responses: Record<string, string>, tools?: string[]): McpClientLike {
  return {
    async listTools() {
      return tools ?? [
        "searchKnowledge",
        "searchWeb",
        "fetchWebPage",
        "extractLinksFromPage",
        "fetchRobotsOrSitemap",
        "fetchGitHubReadme",
        "fetchNpmPackageInfo",
        "formatReport"
      ];
    },
    async callTool(name, args) {
      const key =
        name === "formatReport"
          ? `${name}:${String(args.title)}`
          : name === "searchWeb"
            ? `${name}:${String(args.query)}`
            : name === "searchKnowledge"
              ? `${name}:${String(args.query)}`
              : name === "fetchNpmPackageInfo"
                ? `${name}:${String(args.packageName)}`
                : name === "fetchGitHubReadme"
                  ? `${name}:${String(args.repoUrl)}`
              : `${name}:${String(args.url)}`;

      return {
        text: responses[key] ?? JSON.stringify({ results: [] }),
        raw: responses[key] ?? ""
      };
    },
    async close() {
      return;
    }
  };
}

describe("WorkerAgent", () => {
  test("executes a research task and returns structured evidence", async () => {
    const client = createFakeClient({
      "searchKnowledge:Busca informacion sobre MCP y luego crea un reporte corto": JSON.stringify({
        query: "Busca informacion sobre MCP y luego crea un reporte corto",
        results: [{ topic: "mcp", text: "MCP is a standard protocol for tools." }]
      }),
      "searchWeb:Busca informacion sobre MCP y luego crea un reporte corto": JSON.stringify({
        query: "Busca informacion sobre MCP y luego crea un reporte corto",
        results: [{ title: "MCP Docs", url: "https://modelcontextprotocol.io/docs" }]
      }),
      "fetchWebPage:https://modelcontextprotocol.io/docs": JSON.stringify({
        url: "https://modelcontextprotocol.io/docs",
        preview: "The Model Context Protocol provides a standard way to connect models to tools and resources."
      }),
      "extractLinksFromPage:https://modelcontextprotocol.io/docs": JSON.stringify({
        url: "https://modelcontextprotocol.io/docs",
        links: []
      }),
      "fetchRobotsOrSitemap:https://modelcontextprotocol.io/docs": JSON.stringify({
        url: "https://modelcontextprotocol.io/docs",
        robotsPreview: "",
        sitemapPreview: ""
      }),
      "formatReport:Lyra Research Report":
        "# Lyra Research Report\n\nThe Model Context Protocol provides a standard way to connect models to tools and resources."
    });

    const worker = new WorkerAgent(() => client);
    const task: TaskRequest = {
      id: "task-1",
      goal: "Busca informacion sobre MCP y luego crea un reporte corto",
      outputFormat: "text"
    };

    const result = await worker.execute(task, plan, {
      provider: new FakeProvider()
    });

    expect(result.status).toBe("success");
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(3);
    expect(result.summary).toContain("Lyra Research Report");
    expect(result.data?.agentName).toBe(LYRA_AGENT_NAME);
    expect(result.data?.prompt).toBe(LYRA_AGENT_PROMPT);
    expect(result.confidence === "high" || result.confidence === "medium").toBe(true);
    expect(result.sources.length).toBeGreaterThanOrEqual(1);
  });

  test("persists across rounds and reformulates when the first query is weak", async () => {
    const worker = new WorkerAgent(() =>
      createFakeClient({
        "fetchWebPage:https://www.npmjs.com/package/vinext": JSON.stringify({
          url: "https://www.npmjs.com/package/vinext",
          preview: "vinext package page with release metadata and install instructions."
        }),
        "fetchNpmPackageInfo:vinext": JSON.stringify({
          packageName: "vinext",
          description: "A Next.js-compatible runtime and framework surface built on Vite.",
          latestVersion: "0.8.0",
          homepage: "https://vinext.io/",
          repositoryUrl: "https://github.com/openvitejs/vinext",
          keywords: ["vite", "nextjs", "cloudflare"],
          license: "MIT"
        }),
        "fetchWebPage:https://github.com/openvitejs/vinext": JSON.stringify({
          url: "https://github.com/openvitejs/vinext",
          preview: "GitHub repository for vinext."
        }),
        "fetchGitHubReadme:https://github.com/openvitejs/vinext": JSON.stringify({
          repoUrl: "https://github.com/openvitejs/vinext",
          readmeUrl: "https://raw.githubusercontent.com/openvitejs/vinext/refs/heads/main/README.md",
          preview: "Vinext is a reimplementation of the Next.js API surface on top of Vite, designed for Cloudflare Workers."
        }),
        "extractLinksFromPage:https://github.com/openvitejs/vinext": JSON.stringify({
          url: "https://github.com/openvitejs/vinext",
          links: []
        }),
        "searchWeb:que es vinext": JSON.stringify({ query: "que es vinext", results: [] }),
        "searchWeb:vinext cloudflare framework": JSON.stringify({ query: "vinext cloudflare framework", results: [] }),
        "searchWeb:vinext cloudflare framework official": JSON.stringify({
          query: "vinext cloudflare framework official",
          results: [
            { title: "vinext npm package", url: "https://www.npmjs.com/package/vinext" },
            { title: "Vinext", url: "https://vinext.io/" }
          ]
        }),
        "fetchWebPage:https://vinext.io/": JSON.stringify({
          url: "https://vinext.io/",
          preview: "Vinext is a reimplementation of the Next.js API surface on top of Vite."
        }),
        "extractLinksFromPage:https://vinext.io/": JSON.stringify({
          url: "https://vinext.io/",
          links: [{ url: "https://vinext.io/docs/getting-started", text: "Getting started" }]
        }),
        "fetchWebPage:https://vinext.io/docs/getting-started": JSON.stringify({
          url: "https://vinext.io/docs/getting-started",
          preview: "Deploy to Cloudflare Workers with a drop-in Next.js compatible runtime."
        }),
        "extractLinksFromPage:https://vinext.io/docs/getting-started": JSON.stringify({
          url: "https://vinext.io/docs/getting-started",
          links: []
        }),
        "fetchRobotsOrSitemap:https://vinext.io/": JSON.stringify({
          url: "https://vinext.io/",
          robotsPreview: "Sitemap: https://vinext.io/sitemap.xml",
          sitemapPreview: ""
        }),
        "fetchRobotsOrSitemap:https://vinext.io/docs/getting-started": JSON.stringify({
          url: "https://vinext.io/docs/getting-started",
          robotsPreview: "",
          sitemapPreview: ""
        }),
        "formatReport:Lyra Research Report":
          "# Lyra Research Report\n\nVinext is a reimplementation of the Next.js API surface on top of Vite."
      })
    );

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
    expect(result.visitedUrls).toContain("https://github.com/openvitejs/vinext");
    expect(result.visitedUrls.some((url) => url.includes("npmjs.com/package/vinext") || url.includes("vinext.io"))).toBe(true);
    expect(result.officialSourceFound).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.reasoningSummary).toContain("fuente oficial");
    expect(result.reasoningSummary).toContain("README");
    expect(result.reasoningSummary).toContain("npm");
  });

  test("uses the refined goal instead of slangy user wording", async () => {
    const worker = new WorkerAgent(() =>
      createFakeClient({
        "fetchWebPage:https://www.npmjs.com/package/vinext": JSON.stringify({
          url: "https://www.npmjs.com/package/vinext",
          preview: "vinext package page with release metadata and install instructions."
        }),
        "fetchNpmPackageInfo:vinext": JSON.stringify({
          packageName: "vinext",
          description: "A Next.js-compatible runtime and framework surface built on Vite.",
          latestVersion: "0.8.0",
          homepage: "https://vinext.io/",
          repositoryUrl: "https://github.com/openvitejs/vinext",
          keywords: ["vite", "nextjs", "cloudflare"],
          license: "MIT"
        }),
        "fetchWebPage:https://github.com/openvitejs/vinext": JSON.stringify({
          url: "https://github.com/openvitejs/vinext",
          preview: "GitHub repository for vinext."
        }),
        "fetchGitHubReadme:https://github.com/openvitejs/vinext": JSON.stringify({
          repoUrl: "https://github.com/openvitejs/vinext",
          readmeUrl: "https://raw.githubusercontent.com/openvitejs/vinext/refs/heads/main/README.md",
          preview: "Vinext is a reimplementation of the Next.js API surface on top of Vite."
        }),
        "extractLinksFromPage:https://github.com/openvitejs/vinext": JSON.stringify({
          url: "https://github.com/openvitejs/vinext",
          links: []
        }),
        "formatReport:Lyra Research Report":
          "# Lyra Research Report\n\nVinext is a reimplementation of the Next.js API surface on top of Vite."
      })
    );

    const result = await worker.execute(
      {
        id: "task-slang",
        goal: "que es vinext amigaso?",
        resolvedGoal: "que es vinext"
      },
      plan,
      {
        provider: new FakeProvider()
      }
    );

    expect(result.status).toBe("success");
    expect(result.queriesTried.every((query) => !query.includes("amigaso"))).toBe(true);
    expect(result.sources.some((source) => source.domain === "npmjs.com" || source.domain === "github.com")).toBe(true);
  });

  test("executes explicit curl requests directly instead of entering research mode", async () => {
    const worker = new WorkerAgent(() =>
      createFakeClient(
        {
          "curlRequest:https://httpbin.org/get": JSON.stringify({
            url: "https://httpbin.org/get",
            effectiveUrl: "https://httpbin.org/get",
            method: "GET",
            statusCode: 200,
            contentType: "application/json",
            bodyPreview: '{"args":{},"ok":true}'
          })
        },
        ["curlRequest", "fetchWebPage", "searchWeb", "browserStatus"]
      )
    );

    const result = await worker.execute(
      {
        id: "task-curl",
        goal: "puedes hacer un curl a esta url https://httpbin.org/get"
      },
      plan,
      {
        provider: new FakeProvider()
      }
    );

    expect(result.status).toBe("success");
    expect(result.toolCalls.some((call) => call.toolName === "curlRequest")).toBe(true);
    expect(result.toolCalls.some((call) => call.toolName === "browserStatus")).toBe(false);
    expect(result.summary).toContain("Status: 200");
    expect(result.summary).toContain('{"args":{},"ok":true}');
  });
});
