import { describe, expect, test } from "bun:test";
import { ManagerAgent } from "../src/agents/manager-agent.ts";
import { WorkerAgent } from "../src/agents/worker-agent.ts";
import type { CredentialResolver } from "../src/config/credential-resolver.ts";
import type { OrkionConfig } from "../src/config/types.ts";
import { ModelPolicyResolver } from "../src/providers/model-policy-resolver.ts";
import { ProviderRegistry, type ProviderFactory } from "../src/providers/provider-registry.ts";
import type { GenerateTextRequest, GenerateTextResult, LLMProvider } from "../src/providers/types.ts";
import type { TaskRequest } from "../src/types/agent.ts";

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

describe("ManagerAgent", () => {
  test("delegates to the worker for tool-oriented tasks", async () => {
    const registry = new ProviderRegistry(baseConfig, fakeCredentials, fakeFactory);
    const policy = new ModelPolicyResolver(baseConfig, registry);
    const manager = new ManagerAgent(registry, policy, new WorkerAgent());
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
    const manager = new ManagerAgent(registry, policy, new WorkerAgent());

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
    const manager = new ManagerAgent(registry, policy, new WorkerAgent());

    const result = await manager.run({
      id: "task-3",
      goal: "Saluda al usuario de forma breve"
    });

    expect(result.delegated).toBe(false);
    expect(result.text).toContain("FAKE RESPONSE");
  });
});
