import { ManagerAgent } from "../agents/manager-agent.ts";
import { WorkerAgent } from "../agents/worker-agent.ts";
import { CredentialResolver } from "../config/credential-resolver.ts";
import { loadConfig } from "../config/load-config.ts";
import type { OrkionConfig } from "../config/types.ts";
import type { McpClientLike } from "../mcp/client-adapter.ts";
import { ModelPolicyResolver } from "../providers/model-policy-resolver.ts";
import { createDefaultProviderFactory, type ProviderFactory, ProviderRegistry } from "../providers/provider-registry.ts";

export interface CreateRuntimeOptions {
  config?: OrkionConfig;
  providerFactory?: ProviderFactory;
  mcpClientFactory?: () => McpClientLike;
}

export function createOrkionRuntime(options: CreateRuntimeOptions = {}) {
  const config = options.config ?? loadConfig();
  const credentials = new CredentialResolver();
  const registry = new ProviderRegistry(config, credentials, options.providerFactory ?? createDefaultProviderFactory());
  const modelPolicy = new ModelPolicyResolver(config, registry);
  const worker = new WorkerAgent(options.mcpClientFactory);
  const manager = new ManagerAgent(registry, modelPolicy, worker);

  return {
    config,
    credentials,
    registry,
    modelPolicy,
    worker,
    manager
  };
}
