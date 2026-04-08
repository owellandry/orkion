import { expect, test, describe } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSystemMcpServer } from "../src/mcp/system-server.ts";

describe("System MCP Server", () => {
  test("creates server with correct tools", async () => {
    const server = createSystemMcpServer();
    const client = new Client({
      name: "test-client",
      version: "1.0.0"
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name);

    expect(toolNames).toContain("getOsContext");
    expect(toolNames).toContain("runCommand");
  });
});
