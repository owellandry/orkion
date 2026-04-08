import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";

const execAsync = promisify(exec);

export function createGitMcpServer(): McpServer {
  const server = new McpServer({
    name: "orkion-git-mcp",
    version: "1.0.0"
  });

  const getOsContextSchema = {};

  server.registerTool(
    "getOsContext",
    {
      description: "Gets information about the current operating system and environment to help format commands.",
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

  const gitExecSchema = {
    command: z.string().describe("The git command to execute, including 'git'. Example: 'git status' or 'git commit -m \"fix\"'"),
    cwd: z.string().optional().describe("Optional directory to run the command in. Defaults to current working directory.")
  };

  server.registerTool(
    "gitExec",
    {
      description: "Executes a git command in the shell and returns the output.",
      inputSchema: z.object(gitExecSchema)
    },
    async ({ command, cwd }: z.infer<z.ZodObject<typeof gitExecSchema>>) => {
      if (!command.trim().startsWith("git ")) {
        throw new Error("Only 'git' commands are allowed.");
      }

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
