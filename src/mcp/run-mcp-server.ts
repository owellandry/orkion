import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpUtilityServer } from "./utility-server.ts";

async function main(): Promise<void> {
  const server = createMcpUtilityServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start orkion MCP server:", error);
  process.exit(1);
});
