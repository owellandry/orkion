import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createBrowserMcpServer, type BrowserRunner } from "../src/mcp/browser-server.ts";

describe("Browser MCP server", () => {
  test("browserInspectPage exposes rendered metadata and links", async () => {
    const previousBrowserPath = process.env.ORKION_BROWSER_PATH;
    process.env.ORKION_BROWSER_PATH = process.execPath;

    const fakeRunner: BrowserRunner = async () => ({
      exitCode: 0,
      stderr: "",
      stdout: `
        <html>
          <head>
            <title>OpenVite</title>
            <meta name="description" content="Rendered framework docs" />
          </head>
          <body>
            <h1>OpenVite</h1>
            <h2>Getting Started</h2>
            <a href="/docs">Docs</a>
            <a href="https://github.com/openvite/openvite">GitHub</a>
            <p>OpenVite is a framework on top of Vite.</p>
          </body>
        </html>
      `
    });

    const server = createBrowserMcpServer(fakeRunner);
    const client = new Client({
      name: "browser-test-client",
      version: "1.0.0"
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = (await client.callTool(
      {
        name: "browserInspectPage",
        arguments: {
          url: "https://openvite.dev"
        }
      },
      CallToolResultSchema
    )) as CallToolResult;

    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    expect(text).toContain('"title":"OpenVite"');
    expect(text).toContain("Rendered framework docs");
    expect(text).toContain("https://openvite.dev/docs");
    expect(text).toContain("https://github.com/openvite/openvite");

    if (previousBrowserPath === undefined) {
      delete process.env.ORKION_BROWSER_PATH;
    } else {
      process.env.ORKION_BROWSER_PATH = previousBrowserPath;
    }
  });
});
