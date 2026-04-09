import { describe, expect, test } from "bun:test";
import { ManagerAgent } from "../src/agents/manager-agent.ts";
import { WorkerAgent } from "../src/agents/worker-agent.ts";
import type { CredentialResolver } from "../src/config/credential-resolver.ts";
import type { OrkionConfig } from "../src/config/types.ts";
import type { McpClientLike } from "../src/mcp/client-adapter.ts";
import { ModelPolicyResolver } from "../src/providers/model-policy-resolver.ts";
import { ProviderRegistry, type ProviderFactory } from "../src/providers/provider-registry.ts";
import type { GenerateTextRequest, GenerateTextResult, LLMProvider } from "../src/providers/types.ts";
import type { AgentExecutionContext, AgentTaskResult, DelegationPlan, SubAgent, TaskRequest } from "../src/types/agent.ts";

class FakeProvider implements LLMProvider {
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
      text: `FAKE RESPONSE :: ${request.model} :: ${request.prompt.slice(0, 48)}`
    };
  }

  async streamText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    const text = `FAKE RESPONSE :: ${request.model} :: ${request.prompt.slice(0, 48)}`;
    request.onToken?.(text);
    return { text };
  }
}

const fakeFactory: ProviderFactory = () => new FakeProvider();

const baseConfig: OrkionConfig = {
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
      enabled: true,
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

const fakeCredentials: CredentialResolver = {
  resolve: () => ({
    openrouter: "router-key"
  }),
  get: () => "router-key",
  has: () => true
};

function createFakeMcpClient(): McpClientLike {
  const responses: Record<string, string> = {
    "searchKnowledge:Busca sobre openrouter y genera un reporte": JSON.stringify({
      query: "Busca sobre openrouter y genera un reporte",
      results: [{ topic: "openrouter", text: "OpenRouter routes requests to multiple models." }]
    }),
    "searchWeb:Busca sobre openrouter y genera un reporte": JSON.stringify({
      query: "Busca sobre openrouter y genera un reporte",
      results: [{ title: "OpenRouter Docs", url: "https://openrouter.ai/docs" }]
    }),
    "fetchWebPage:https://openrouter.ai/docs": JSON.stringify({
      url: "https://openrouter.ai/docs",
      preview: "OpenRouter provides a unified API for many LLM providers."
    }),
    "extractLinksFromPage:https://openrouter.ai/docs": JSON.stringify({ url: "https://openrouter.ai/docs", links: [] }),
    "fetchRobotsOrSitemap:https://openrouter.ai/docs": JSON.stringify({ url: "https://openrouter.ai/docs", robotsPreview: "", sitemapPreview: "" }),
    "formatReport:Lyra Research Report": "# Lyra Research Report\n\nOpenRouter provides a unified API for many LLM providers.",
    "searchWeb:hola, puedes ayudarme a entender como funciona vinext, busca info del framework": JSON.stringify({
      query: "hola, puedes ayudarme a entender como funciona vinext, busca info del framework",
      results: []
    }),
    "searchWeb:vinext framework": JSON.stringify({
      query: "vinext framework",
      results: [{ title: "Vinext", url: "https://vinext.io/" }]
    }),
    "fetchWebPage:https://vinext.io/": JSON.stringify({
      url: "https://vinext.io/",
      preview: "Vinext is a reimplementation of the Next.js API surface on top of Vite."
    }),
    "extractLinksFromPage:https://vinext.io/": JSON.stringify({ url: "https://vinext.io/", links: [] }),
    "fetchRobotsOrSitemap:https://vinext.io/": JSON.stringify({ url: "https://vinext.io/", robotsPreview: "", sitemapPreview: "" })
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

describe("ManagerAgent", () => {
  test("delegates to the worker for tool-oriented tasks", async () => {
    const registry = new ProviderRegistry(baseConfig, fakeCredentials, fakeFactory);
    const policy = new ModelPolicyResolver(baseConfig, registry);
    const manager = new ManagerAgent(registry, policy, [new WorkerAgent(() => createFakeMcpClient())]);
    const task: TaskRequest = {
      id: "task-2",
      goal: "Busca sobre openrouter y genera un reporte"
    };

    const result = await manager.run(task);

    expect(result.delegated).toBe(true);
    expect(result.workerResult?.status).toBe("success");
    expect(result.text).toContain("FAKE RESPONSE");
    expect(result.plan.selectedAgent).toBe("lyra");
  });

  test("delegates when the user asks to understand an external framework", async () => {
    const registry = new ProviderRegistry(baseConfig, fakeCredentials, fakeFactory);
    const policy = new ModelPolicyResolver(baseConfig, registry);
    const manager = new ManagerAgent(registry, policy, [new WorkerAgent(() => createFakeMcpClient())]);

    const result = await manager.run({
      id: "task-framework",
      goal: "hola, puedes ayudarme a entender como funciona vinext, busca info del framework"
    });

    expect(result.delegated).toBe(true);
    expect(result.plan.selectedAgent).toBe("lyra");
  });

  test("responds directly when delegation is not needed", async () => {
    const registry = new ProviderRegistry(baseConfig, fakeCredentials, fakeFactory);
    const policy = new ModelPolicyResolver(baseConfig, registry);
    const manager = new ManagerAgent(registry, policy, [new WorkerAgent(() => createFakeMcpClient())]);

    const result = await manager.run({
      id: "task-3",
      goal: "Saluda al usuario de forma breve"
    });

    expect(result.delegated).toBe(false);
    expect(result.text).toContain("FAKE RESPONSE");
  });

  test("handles simple greetings locally without spending a model call", async () => {
    let calls = 0;
    const greetingFactory: ProviderFactory = () => ({
      name: "openrouter" as const,
      capabilities: {
        supportsTools: false,
        supportsStructuredOutput: false
      },
      isConfigured() {
        return true;
      },
      async generateText(): Promise<GenerateTextResult> {
        calls += 1;
        return { text: "should not be used" };
      },
      async streamText(): Promise<GenerateTextResult> {
        calls += 1;
        return { text: "should not be used" };
      }
    });

    const registry = new ProviderRegistry(baseConfig, fakeCredentials, greetingFactory);
    const policy = new ModelPolicyResolver(baseConfig, registry);
    const manager = new ManagerAgent(registry, policy, [new WorkerAgent(() => createFakeMcpClient())]);

    const result = await manager.run({
      id: "task-greeting",
      goal: "hola que tal?"
    });

    expect(result.delegated).toBe(false);
    expect(result.text.toLowerCase()).toContain("hola");
    expect(calls).toBe(0);
  });

  test("handles short check-in chat locally without provider calls", async () => {
    let calls = 0;
    const greetingFactory: ProviderFactory = () => ({
      name: "openrouter" as const,
      capabilities: {
        supportsTools: false,
        supportsStructuredOutput: false
      },
      isConfigured() {
        return true;
      },
      async generateText(): Promise<GenerateTextResult> {
        calls += 1;
        return { text: "should not be used" };
      },
      async streamText(): Promise<GenerateTextResult> {
        calls += 1;
        return { text: "should not be used" };
      }
    });

    const registry = new ProviderRegistry(baseConfig, fakeCredentials, greetingFactory);
    const policy = new ModelPolicyResolver(baseConfig, registry);
    const manager = new ManagerAgent(registry, policy, [new WorkerAgent(() => createFakeMcpClient())]);

    const result = await manager.run({
      id: "task-checkin",
      goal: "como vas?"
    });

    expect(result.delegated).toBe(false);
    expect(result.text.length).toBeGreaterThan(10);
    expect(calls).toBe(0);
  });

  test("resolves date questions locally without delegating", async () => {
    const registry = new ProviderRegistry(baseConfig, fakeCredentials, fakeFactory);
    const policy = new ModelPolicyResolver(baseConfig, registry);
    const manager = new ManagerAgent(registry, policy, [new WorkerAgent(() => createFakeMcpClient())]);

    const result = await manager.run({
      id: "task-date",
      goal: "hola, que tal estas? sabes el dia que es hoy?"
    });

    expect(result.delegated).toBe(false);
    expect(result.plan.intentType).toBe("date_time");
    expect(result.text.toLowerCase()).toContain("hoy es");
  });

  test("uses recent conversation context and strips leaked reasoning", async () => {
    let lastPrompt = "";

    const contextualFactory: ProviderFactory = () => ({
      name: "openrouter" as const,
      capabilities: {
        supportsTools: false,
        supportsStructuredOutput: false
      },
      isConfigured() {
        return true;
      },
      async generateText(request: GenerateTextRequest): Promise<GenerateTextResult> {
        lastPrompt = request.prompt;
        return {
          text: [
            "Okay, el usuario pregunta si openvite es mejor que next.",
            "Parece que se refiere a una comparacion entre frameworks.",
            "",
            "Respuesta:",
            "No es automaticamente mejor que Next.js; depende del caso. OpenVite puede darte una base mas ligera y flexible, mientras Next.js sigue siendo mas maduro y estable para muchos equipos."
          ].join("\n")
        };
      },
      async streamText(request: GenerateTextRequest): Promise<GenerateTextResult> {
        return this.generateText(request);
      }
    });

    const registry = new ProviderRegistry(baseConfig, fakeCredentials, contextualFactory);
    const policy = new ModelPolicyResolver(baseConfig, registry);
    const manager = new ManagerAgent(registry, policy, [new WorkerAgent(() => createFakeMcpClient())]);

    const result = await manager.run({
      id: "task-context",
      goal: "perfecto, puedes entonces si es mejor que next solo? o openvite es peor por asi decirlo?",
      context: [
        "user: hola, puedes ayudarme? quiero saber que es openvite puedes buscar?",
        "assistant: OpenVite es un framework experimental sobre Vite."
      ]
    });

    expect(lastPrompt).toContain("Historial reciente:");
    expect(lastPrompt).toContain("openvite");
    expect(result.text).not.toContain("Okay, el usuario pregunta");
    expect(result.text).toContain("No es automaticamente mejor que Next.js");
  });

  test("returns exact git execution summary without re-synthesizing with the provider", async () => {
    let calls = 0;
    const silentFactory: ProviderFactory = () => ({
      name: "openrouter" as const,
      capabilities: {
        supportsTools: false,
        supportsStructuredOutput: false
      },
      isConfigured() {
        return true;
      },
      async generateText(): Promise<GenerateTextResult> {
        calls += 1;
        return { text: "should not be used for git summaries" };
      },
      async streamText(): Promise<GenerateTextResult> {
        calls += 1;
        return { text: "should not be used for git summaries" };
      }
    });

    const gitWorker: SubAgent = {
      name: "kyra",
      canHandle() {
        return true;
      },
      async execute(_task: TaskRequest, _plan: DelegationPlan, _context?: AgentExecutionContext): Promise<AgentTaskResult> {
        return {
          status: "success",
          summary: "Commit creado: feat: agregar permisos persistentes. Push realizado: branch set up to track origin.",
          toolCalls: [],
          errors: [],
          confidence: "high",
          sources: [],
          queriesTried: [],
          visitedUrls: [],
          officialSourceFound: true,
          reasoningSummary: "Commit y push completados."
        };
      }
    };

    const registry = new ProviderRegistry(baseConfig, fakeCredentials, silentFactory);
    const policy = new ModelPolicyResolver(baseConfig, registry);
    const manager = new ManagerAgent(registry, policy, [gitWorker]);

    const result = await manager.run({
      id: "task-git-factual",
      goal: "puedes hacer un comit de los cambios actuales y push"
    });

    expect(result.delegated).toBe(true);
    expect(result.plan.intentType).toBe("git_operation");
    expect(result.text).toBe("Commit creado: feat: agregar permisos persistentes. Push realizado: branch set up to track origin.");
    expect(calls).toBe(0);
  });

  test("returns exact system execution summary without re-synthesizing with the provider", async () => {
    let calls = 0;
    const silentFactory: ProviderFactory = () => ({
      name: "openrouter" as const,
      capabilities: {
        supportsTools: false,
        supportsStructuredOutput: false
      },
      isConfigured() {
        return true;
      },
      async generateText(): Promise<GenerateTextResult> {
        calls += 1;
        return { text: "should not be used for system summaries" };
      },
      async streamText(): Promise<GenerateTextResult> {
        calls += 1;
        return { text: "should not be used for system summaries" };
      }
    });

    const systemWorker: SubAgent = {
      name: "system",
      canHandle() {
        return true;
      },
      async execute(_task: TaskRequest, _plan: DelegationPlan, _context?: AgentExecutionContext): Promise<AgentTaskResult> {
        return {
          status: "success",
          summary: "Directorio de trabajo: C:\\Users\\burge\\Documents\\orkion\n\nVerificacion:\nC:\\Users\\burge\\Documents\\orkion\\macos",
          toolCalls: [],
          errors: [],
          confidence: "high",
          sources: [],
          queriesTried: [],
          visitedUrls: [],
          officialSourceFound: true,
          reasoningSummary: "summary"
        };
      }
    };

    const registry = new ProviderRegistry(baseConfig, fakeCredentials, silentFactory);
    const policy = new ModelPolicyResolver(baseConfig, registry);
    const manager = new ManagerAgent(registry, policy, [systemWorker]);

    const result = await manager.run({
      id: "task-system-factual",
      goal: "crea en el directorio actual una carpeta llamada macos"
    });

    expect(result.delegated).toBe(true);
    expect(result.plan.intentType).toBe("system_operation");
    expect(result.text).toContain("C:\\Users\\burge\\Documents\\orkion\\macos");
    expect(calls).toBe(0);
  });
});
