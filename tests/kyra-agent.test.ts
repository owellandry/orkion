import { describe, expect, test } from "bun:test";
import { KyraAgent } from "../src/agents/kyra-agent.ts";
import type { McpClientLike } from "../src/mcp/client-adapter.ts";
import type { GenerateTextRequest, GenerateTextResult, LLMProvider } from "../src/providers/types.ts";
import type { DelegationPlan, TaskRequest } from "../src/types/agent.ts";

const plan: DelegationPlan = {
  selectedAgent: "kyra",
  instructions: "Handle git tasks.",
  expectedOutput: "Git summary",
  shouldDelegate: true,
  provider: "openrouter",
  model: "meta-llama/llama-3.3-8b-instruct:free",
  fallbackUsed: false,
  warnings: [],
  intentType: "git_operation",
  researchRequired: false
};

class FakeProvider implements LLMProvider {
  readonly name = "openrouter" as const;
  readonly capabilities = {
    supportsTools: false,
    supportsStructuredOutput: false
  };

  isConfigured(): boolean {
    return true;
  }

  async generateText(_request: GenerateTextRequest): Promise<GenerateTextResult> {
    return {
      text: JSON.stringify({
        subject: "feat: improve intent handling and git workflow",
        body: "Refina la deteccion de tareas Git y mejora la generacion de commits para que el flujo sea mas confiable."
      })
    };
  }

  async streamText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    const text = JSON.stringify({
      subject: "feat: improve intent handling and git workflow",
      body: "Refina la deteccion de tareas Git y mejora la generacion de commits para que el flujo sea mas confiable."
    });
    request.onToken?.(text);
    return { text };
  }
}

function createGitClient(responses: Record<string, string>): McpClientLike {
  return {
    async listTools() {
      return ["gitExec"];
    },
    async callTool(name, args) {
      const key = `${name}:${String(args.command ?? "")}`;
      return {
        text: responses[key] ?? JSON.stringify({ success: true, stdout: "", stderr: "" }),
        raw: responses[key] ?? ""
      };
    },
    async close() {
      return;
    }
  };
}

describe("KyraAgent", () => {
  test("canHandle detects git operations correctly", () => {
    const kyra = new KyraAgent(() => ({} as McpClientLike));

    expect(kyra.canHandle({ goal: "crea un commit" } as TaskRequest)).toBe(true);
    expect(kyra.canHandle({ goal: "haz un push a origin main" } as TaskRequest)).toBe(true);
    expect(kyra.canHandle({ goal: "revisa el status de git" } as TaskRequest)).toBe(true);
    expect(kyra.canHandle({ goal: "creame una nueva rama feature-1" } as TaskRequest)).toBe(true);

    expect(kyra.canHandle({ goal: "quien es el presidente de francia" } as TaskRequest)).toBe(false);
    expect(kyra.canHandle({ goal: "calcula 2 + 2" } as TaskRequest)).toBe(false);
  });

  test("creates a specific commit and pushes current branch even with common commit typos", async () => {
    const kyra = new KyraAgent(() =>
      createGitClient({
        "gitExec:git status --short --branch": JSON.stringify({
          success: true,
          stdout: "## feature/research...origin/feature/research\n M src/agents/intent-agent.ts\n M src/agents/manager-agent.ts",
          stderr: ""
        }),
        "gitExec:git add -A": JSON.stringify({
          success: true,
          stdout: "",
          stderr: ""
        }),
        "gitExec:git diff --cached --name-status": JSON.stringify({
          success: true,
          stdout: "M\tsrc/agents/intent-agent.ts\nM\tsrc/agents/manager-agent.ts",
          stderr: ""
        }),
        "gitExec:git diff --cached --stat": JSON.stringify({
          success: true,
          stdout: " src/agents/intent-agent.ts | 22 ++++++++++++++------\n src/agents/manager-agent.ts | 18 ++++++++++----\n 2 files changed, 28 insertions(+), 12 deletions(-)",
          stderr: ""
        }),
        'gitExec:git commit -m "feat: improve intent handling and git workflow" -m "Refina la deteccion de tareas Git y mejora la generacion de commits para que el flujo sea mas confiable."': JSON.stringify({
          success: true,
          stdout: "[feature/research abc1234] feat: improve intent handling and git workflow",
          stderr: ""
        }),
        "gitExec:git push -u origin HEAD": JSON.stringify({
          success: true,
          stdout: "branch 'feature/research' set up to track 'origin/feature/research'.",
          stderr: ""
        })
      })
    );

    const result = await kyra.execute(
      {
        id: "git-commit",
        goal: "puedes hacer un comit con los cambios actuales de mi proyecto y hacer push de la rama por favor"
      },
      plan,
      {
        provider: new FakeProvider()
      }
    );

    expect(result.status).toBe("success");
    expect(result.summary).toContain("feat: improve intent handling and git workflow");
    expect(result.summary).toContain("Descripcion:");
    expect(result.toolCalls.some((call) => String(call.arguments.command).includes('git commit -m "feat: improve intent handling and git workflow" -m "Refina la deteccion de tareas Git y mejora la generacion de commits para que el flujo sea mas confiable."'))).toBe(true);
    expect(result.toolCalls.some((call) => String(call.arguments.command).includes("git push -u origin HEAD"))).toBe(true);
  });

  test("does not claim nothing to do when branch is ahead and push is requested", async () => {
    const kyra = new KyraAgent(() =>
      createGitClient({
        "gitExec:git status --short --branch": JSON.stringify({
          success: true,
          stdout: "## feature/research...origin/feature/research [ahead 1]",
          stderr: ""
        }),
        "gitExec:git push -u origin HEAD": JSON.stringify({
          success: true,
          stdout: "Everything up-to-date",
          stderr: ""
        })
      })
    );

    const result = await kyra.execute(
      {
        id: "git-push",
        goal: "haz push de la rama actual por favor"
      },
      plan,
      {
        provider: new FakeProvider()
      }
    );

    expect(result.status).toBe("success");
    expect(result.summary).toContain("Push realizado");
  });
});
