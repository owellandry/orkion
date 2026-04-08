import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createMcpUtilityServer, type CurlRunner } from "../src/mcp/utility-server.ts";

describe("MCP utility server web tools", () => {
  test("searchWeb uses curl and returns parsed search results", async () => {
    const fakeCurl: CurlRunner = async (args) => {
      const joined = args.join(" ");
      if (joined.includes("duckduckgo")) {
        return {
          exitCode: 0,
          stderr: "",
          stdout:
            '<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example Docs</a>'
        };
      }

      return {
        exitCode: 0,
        stderr: "",
        stdout: "<html></html>"
      };
    };

    const server = createMcpUtilityServer(fakeCurl);
    const client = new Client({
      name: "test-client",
      version: "1.0.0"
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = (await client.callTool(
      {
        name: "searchWeb",
        arguments: {
          query: "orkion docs",
          maxResults: 1
        }
      },
      CallToolResultSchema
    )) as CallToolResult;

    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    expect(text).toContain("Example Docs");
    expect(text).toContain("https://example.com/docs");
  });
});
