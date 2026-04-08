import type { McpClientLike, McpToolResponse } from "./client-adapter.ts";
import type { PermissionController } from "../runtime/permission-control.ts";

export class PermissionAwareMcpClient implements McpClientLike {
  constructor(
    private readonly inner: McpClientLike,
    private readonly permissions: PermissionController
  ) {}

  async listTools(): Promise<string[]> {
    return this.inner.listTools();
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResponse> {
    await this.permissions.ensureToolPermission(name);
    return this.inner.callTool(name, args);
  }

  async close(): Promise<void> {
    await this.inner.close();
  }
}
