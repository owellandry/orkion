import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createGitMcpServer } from "./git-server.ts";

async function main(): Promise<void> {
  const server = createGitMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start orkion Git MCP server:", error);
  process.exit(1);
});