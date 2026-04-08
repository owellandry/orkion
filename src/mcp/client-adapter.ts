import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "node:url";

export interface McpToolResponse {
  text: string;
  raw: unknown;
}

export interface McpClientLike {
  listTools(): Promise<string[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResponse>;
  close(): Promise<void>;
}

type ToolOwner = "utility" | "browser";

interface ManagedClient {
  kind: ToolOwner;
  serverRelativePath: string;
  client?: Client;
  transport?: StdioClientTransport;
  connected: boolean;
  disabled?: boolean;
}

function createManagedClient(kind: ToolOwner, serverRelativePath: string): ManagedClient {
  return {
    kind,
    serverRelativePath,
    connected: false
  };
}

export class McpClientAdapter implements McpClientLike {
  private readonly utilityClient = createManagedClient("utility", "./run-mcp-server.ts");
  private readonly browserClient = createManagedClient("browser", "./run-browser-mcp-server.ts");
  private readonly toolOwners = new Map<string, ToolOwner>();

  private async ensureConnected(target: ManagedClient): Promise<void> {
    if (target.connected || target.disabled) {
      return;
    }

    const serverPath = fileURLToPath(new URL(target.serverRelativePath, import.meta.url));
    target.client = new Client({
      name: `orkion-${target.kind}-client`,
      version: "0.1.0"
    });
    target.transport = new StdioClientTransport({
      command: "bun",
      args: [serverPath],
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      stderr: "pipe"
    });

    try {
      await target.client.connect(target.transport);
      target.connected = true;
    } catch {
      target.disabled = true;
      await target.transport?.close().catch(() => undefined);
      target.transport = undefined;
      target.client = undefined;
    }
  }

  private async listToolsFrom(target: ManagedClient): Promise<string[]> {
    await this.ensureConnected(target);
    if (!target.connected || !target.client) {
      return [];
    }

    const result = await target.client.listTools();
    return result.tools.map((tool) => tool.name);
  }

  async listTools(): Promise<string[]> {
    const [utilityTools, browserTools] = await Promise.all([
      this.listToolsFrom(this.utilityClient),
      this.listToolsFrom(this.browserClient)
    ]);

    this.toolOwners.clear();
    for (const name of utilityTools) {
      this.toolOwners.set(name, "utility");
    }
    for (const name of browserTools) {
      this.toolOwners.set(name, "browser");
    }

    return [...this.toolOwners.keys()];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResponse> {
    if (!this.toolOwners.has(name)) {
      await this.listTools();
    }

    const owner = this.toolOwners.get(name);
    if (!owner) {
      throw new Error(`Unknown MCP tool: ${name}`);
    }

    const target = owner === "utility" ? this.utilityClient : this.browserClient;
    await this.ensureConnected(target);

    if (!target.client) {
      throw new Error(`MCP client unavailable for tool: ${name}`);
    }

    const result = (await target.client.callTool(
      {
        name,
        arguments: args
      },
      CallToolResultSchema
    )) as CallToolResult;

    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n")
      .trim();

    return {
      text,
      raw: result
    };
  }

  async close(): Promise<void> {
    for (const target of [this.utilityClient, this.browserClient]) {
      if (!target.connected) {
        continue;
      }

      await target.transport?.close().catch(() => undefined);
      target.connected = false;
      target.client = undefined;
      target.transport = undefined;
    }
  }
}
