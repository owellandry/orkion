import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";

const execAsync = promisify(exec);

export function createSystemMcpServer(): McpServer {
  const server = new McpServer({
    name: "orkion-system-mcp",
    version: "1.0.0"
  });

  server.registerTool(
    "getOsContext",
    {
      description: "Obtiene información sobre el sistema operativo actual y entorno.",
      inputSchema: z.object({})
    },
    async () => {
      const context = {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        cwd: process.cwd()
      };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(context, null, 2)
          }
        ]
      };
    }
  );

  const runCommandSchema = {
    command: z.string().describe("El comando de shell a ejecutar."),
    cwd: z.string().optional().describe("Directorio de trabajo opcional.")
  };

  server.registerTool(
    "runCommand",
    {
      description: "Ejecuta un comando en el shell del sistema y devuelve la salida.",
      inputSchema: z.object(runCommandSchema)
    },
    async ({ command, cwd }: z.infer<z.ZodObject<typeof runCommandSchema>>) => {
      try {
        const { stdout, stderr } = await execAsync(command, { cwd: cwd || process.cwd() });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                stdout: stdout.trim(),
                stderr: stderr.trim()
              })
            }
          ]
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error.message,
                stdout: error.stdout?.toString().trim(),
                stderr: error.stderr?.toString().trim()
              })
            }
          ]
        };
      }
    }
  );

  return server;
}
