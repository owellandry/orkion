import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBrowserMcpServer } from "./browser-server.ts";

async function main(): Promise<void> {
  const server = createBrowserMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start orkion browser MCP server:", error);
  process.exit(1);
});
