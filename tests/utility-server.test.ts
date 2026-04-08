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

  test("fetchGitHubReadme and fetchNpmPackageInfo expose structured research helpers", async () => {
    const fakeCurl: CurlRunner = async (args) => {
      const target = args[args.length - 1];

      if (target.includes("raw.githubusercontent.com")) {
        return {
          exitCode: 0,
          stderr: "",
          stdout: "# Vinext\n\nVinext is a Next.js-compatible framework surface on top of Vite."
        };
      }

      if (target.includes("registry.npmjs.org")) {
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            name: "vinext",
            description: "Framework surface for Vite and Cloudflare.",
            license: "MIT",
            homepage: "https://vinext.io/",
            repository: { url: "git+https://github.com/openvitejs/vinext.git" },
            keywords: ["vite", "cloudflare"],
            "dist-tags": { latest: "0.8.0" }
          })
        };
      }

      return {
        exitCode: 1,
        stderr: "unexpected url",
        stdout: ""
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

    const readmeResult = (await client.callTool(
      {
        name: "fetchGitHubReadme",
        arguments: {
          repoUrl: "https://github.com/openvitejs/vinext"
        }
      },
      CallToolResultSchema
    )) as CallToolResult;

    const npmResult = (await client.callTool(
      {
        name: "fetchNpmPackageInfo",
        arguments: {
          packageName: "vinext"
        }
      },
      CallToolResultSchema
    )) as CallToolResult;

    const readmeText = readmeResult.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    const npmText = npmResult.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    expect(readmeText).toContain("Vinext is a Next.js-compatible framework surface on top of Vite");
    expect(npmText).toContain('"packageName":"vinext"');
    expect(npmText).toContain('"repositoryUrl":"https://github.com/openvitejs/vinext"');
  });

  test("curlRequest returns status and raw body preview", async () => {
    const fakeCurl: CurlRunner = async () => ({
      exitCode: 0,
      stderr: "",
      stdout:
        '{"hello":"world"}\n__ORKION_META__{"http_code":"200","content_type":"application/json","url_effective":"https://httpbin.org/get"}\n'
    });

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
        name: "curlRequest",
        arguments: {
          url: "https://httpbin.org/get",
          method: "GET"
        }
      },
      CallToolResultSchema
    )) as CallToolResult;

    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    expect(text).toContain('"statusCode":200');
    expect(text).toContain('"contentType":"application/json"');
    expect(text).toContain('"bodyPreview":"{\\"hello\\":\\"world\\"}"');
  });
});
