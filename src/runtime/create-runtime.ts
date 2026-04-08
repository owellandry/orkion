import { ManagerAgent } from "../agents/manager-agent.ts";
import { WorkerAgent } from "../agents/worker-agent.ts";
import { KyraAgent } from "../agents/kyra-agent.ts";
import { SystemAgent } from "../agents/system-agent.ts";
import { CredentialResolver } from "../config/credential-resolver.ts";
import { loadConfig } from "../config/load-config.ts";
import type { OrkionConfig } from "../config/types.ts";
import { McpClientAdapter, type McpClientLike } from "../mcp/client-adapter.ts";
import { GitMcpClientAdapter } from "../mcp/git-client-adapter.ts";
import { SystemMcpClientAdapter } from "../mcp/system-client-adapter.ts";
import { ModelPolicyResolver } from "../providers/model-policy-resolver.ts";
import { createDefaultProviderFactory, type ProviderFactory, ProviderRegistry } from "../providers/provider-registry.ts";
import type { PermissionController } from "./permission-control.ts";
import { PermissionAwareMcpClient } from "../mcp/permission-client-adapter.ts";

export interface CreateRuntimeOptions {
  config?: OrkionConfig;
  providerFactory?: ProviderFactory;
  mcpClientFactory?: () => McpClientLike;
  gitMcpClientFactory?: () => McpClientLike;
  systemMcpClientFactory?: () => McpClientLike;
  permissionController?: PermissionController;
}

export function createOrkionRuntime(options: CreateRuntimeOptions = {}) {
  const config = options.config ?? loadConfig();
  const credentials = new CredentialResolver();
  const registry = new ProviderRegistry(config, credentials, options.providerFactory ?? createDefaultProviderFactory());
  const modelPolicy = new ModelPolicyResolver(config, registry);
  const wrapClient = (factory: () => McpClientLike): (() => McpClientLike) => {
    if (!options.permissionController) {
      return factory;
    }

    return () => new PermissionAwareMcpClient(factory(), options.permissionController!);
  };
  
  const lyra = new WorkerAgent(wrapClient(options.mcpClientFactory ?? (() => new McpClientAdapter())));
  const kyra = new KyraAgent(wrapClient(options.gitMcpClientFactory ?? (() => new GitMcpClientAdapter())));
  const system = new SystemAgent(wrapClient(options.systemMcpClientFactory ?? (() => new SystemMcpClientAdapter())));
  
  const manager = new ManagerAgent(registry, modelPolicy, [system, kyra, lyra]);

  return {
    config,
    credentials,
    registry,
    modelPolicy,
    workers: [system, kyra, lyra],
    manager
  };
}
