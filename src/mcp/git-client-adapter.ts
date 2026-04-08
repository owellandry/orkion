import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "node:url";
import type { McpClientLike, McpToolResponse } from "./client-adapter.ts";

export class GitMcpClientAdapter implements McpClientLike {
  private client?: Client;
  private transport?: StdioClientTransport;
  private connected = false;

  private async ensureConnected(): Promise<void> {
    if (this.connected) {
      return;
    }

    const serverPath = fileURLToPath(new URL("./run-git-mcp-server.ts", import.meta.url));
    this.client = new Client({
      name: "orkion-kyra-client",
      version: "1.0.0"
    });
    this.transport = new StdioClientTransport({
      command: "bun",
      args: [serverPath],
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      stderr: "pipe"
    });

    await this.client.connect(this.transport);
    this.connected = true;
  }

  async listTools(): Promise<string[]> {
    await this.ensureConnected();
    const result = await this.client!.listTools();
    return result.tools.map((tool) => tool.name);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResponse> {
    await this.ensureConnected();
    const result = (await this.client!.callTool({
      name,
      arguments: args
    }, CallToolResultSchema)) as CallToolResult;
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
    if (!this.connected) {
      return;
    }

    await this.transport?.close();
    this.connected = false;
    this.client = undefined;
    this.transport = undefined;
  }
}