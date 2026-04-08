import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSystemMcpServer } from "./system-server.ts";

async function main(): Promise<void> {
  const server = createSystemMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start orkion System MCP server:", error);
  process.exit(1);
});
