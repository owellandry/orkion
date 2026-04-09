import { describe, expect, test } from "bun:test";
import { SystemAgent } from "../src/agents/system-agent.ts";
import type { McpClientLike } from "../src/mcp/client-adapter.ts";
import type { GenerateTextRequest, GenerateTextResult, LLMProvider } from "../src/providers/types.ts";
import type { DelegationPlan } from "../src/types/agent.ts";

const plan: DelegationPlan = {
  selectedAgent: "system",
  instructions: "Handle system tasks.",
  expectedOutput: "System summary",
  shouldDelegate: true,
  provider: "openrouter",
  model: "meta-llama/llama-3.3-8b-instruct:free",
  fallbackUsed: false,
  warnings: [],
  intentType: "system_operation",
  researchRequired: false
};

class SequencedSystemProvider implements LLMProvider {
  readonly name = "openrouter" as const;
  readonly capabilities = {
    supportsTools: false,
    supportsStructuredOutput: false
  };

  private index = 0;

  constructor(private readonly responses: string[]) {}

  isConfigured(): boolean {
    return true;
  }

  async generateText(_request: GenerateTextRequest): Promise<GenerateTextResult> {
    const text = this.responses[this.index] ?? this.responses[this.responses.length - 1] ?? "{}";
    this.index += 1;
    return { text };
  }

  async streamText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    return this.generateText(request);
  }
}

function createSystemClient(commandOutputs: string[]): McpClientLike {
  let commandIndex = 0;

  return {
    async listTools() {
      return ["getOsContext", "runCommand"];
    },
    async callTool(name) {
      if (name === "getOsContext") {
        return {
          text: JSON.stringify({
            platform: "win32",
            cwd: "C:\\Users\\burge\\Documents\\orkion"
          }),
          raw: ""
        };
      }

      const stdout = commandOutputs[commandIndex] ?? commandOutputs[commandOutputs.length - 1] ?? "";
      commandIndex += 1;

      return {
        text: JSON.stringify({
          success: true,
          cwd: "C:\\Users\\burge\\Documents\\orkion",
          stdout,
          stderr: ""
        }),
        raw: stdout
      };
    },
    async close() {
      return;
    }
  };
}

describe("SystemAgent execution", () => {
  test("returns a user-facing summary based on verified directory creation", async () => {
    const system = new SystemAgent(() =>
      createSystemClient([
        "C:\\Users\\burge\\Documents\\orkion\\macos",
        "C:\\Users\\burge\\Documents\\orkion\\macos"
      ])
    );

    const provider = new SequencedSystemProvider([
      JSON.stringify({
        command: 'New-Item -ItemType Directory -Path .\\macos -Force | Select-Object -ExpandProperty FullName',
        verifyCommand: 'Get-Item .\\macos | Select-Object -ExpandProperty FullName'
      }),
      JSON.stringify({
        done: true,
        summary: "Hecho. Cree la carpeta C:\\Users\\burge\\Documents\\orkion\\macos.",
        artifacts: [{ kind: "directory", path: "C:\\Users\\burge\\Documents\\orkion\\macos" }]
      })
    ]);

    const result = await system.execute(
      {
        id: "system-create-dir",
        goal: "crea en el directorio actual una carpeta llamada macos"
      },
      plan,
      {
        provider
      }
    );

    expect(result.status).toBe("success");
    expect(result.summary).toContain("Hecho. Cree la carpeta C:\\Users\\burge\\Documents\\orkion\\macos.");
    expect(result.summary).toContain("Carpeta: C:\\Users\\burge\\Documents\\orkion\\macos");
    expect(result.summary).toContain("Ubicacion base: C:\\Users\\burge\\Documents\\orkion");
  });

  test("lets the model create a folder and nested file, then reports verified artifacts", async () => {
    const system = new SystemAgent(() =>
      createSystemClient([
        '{"directory":"C:\\\\Users\\\\burge\\\\Documents\\\\orkion\\\\example","file":"C:\\\\Users\\\\burge\\\\Documents\\\\orkion\\\\example\\\\readme"}',
        '{"directory":"C:\\\\Users\\\\burge\\\\Documents\\\\orkion\\\\example","file":"C:\\\\Users\\\\burge\\\\Documents\\\\orkion\\\\example\\\\readme","content":"helloworld"}'
      ])
    );

    const provider = new SequencedSystemProvider([
      JSON.stringify({
        command:
          '$dir = Join-Path (Get-Location) "example"; New-Item -ItemType Directory -Path $dir -Force | Out-Null; $file = Join-Path $dir "readme"; Set-Content -Path $file -Value "helloworld"',
        verifyCommand:
          '$dir = Join-Path (Get-Location) "example"; $file = Join-Path $dir "readme"; [PSCustomObject]@{ directory = (Get-Item $dir).FullName; file = (Get-Item $file).FullName; content = (Get-Content $file -Raw) } | ConvertTo-Json -Compress'
      }),
      JSON.stringify({
        done: true,
        summary: "Hecho. Cree la carpeta y el archivo solicitados.",
        artifacts: [
          { kind: "directory", path: "C:\\Users\\burge\\Documents\\orkion\\example" },
          { kind: "file", path: "C:\\Users\\burge\\Documents\\orkion\\example\\readme", details: "contenido: helloworld" }
        ]
      })
    ]);

    const result = await system.execute(
      {
        id: "system-create-file",
        goal: "crea en el directorio actual una carpeta llamada example y dentro de si un archivo readme que contenga un helloworld"
      },
      plan,
      {
        provider
      }
    );

    expect(result.status).toBe("success");
    expect(result.summary).toContain("Hecho. Cree la carpeta y el archivo solicitados.");
    expect(result.summary).toContain("Carpeta: C:\\Users\\burge\\Documents\\orkion\\example");
    expect(result.summary).toContain("Archivo: C:\\Users\\burge\\Documents\\orkion\\example\\readme (contenido: helloworld)");
  });

  test("fails fast with a clear message when the planner model times out", async () => {
    const system = new SystemAgent(
      () => createSystemClient([]),
      20
    );

    const hangingProvider: LLMProvider = {
      name: "openrouter",
      capabilities: {
        supportsTools: false,
        supportsStructuredOutput: false
      },
      isConfigured() {
        return true;
      },
      async generateText(): Promise<GenerateTextResult> {
        return await new Promise<GenerateTextResult>((resolve) => {
          setTimeout(() => resolve({ text: "{}" }), 100);
        });
      },
      async streamText(): Promise<GenerateTextResult> {
        return await new Promise<GenerateTextResult>((resolve) => {
          setTimeout(() => resolve({ text: "{}" }), 100);
        });
      }
    };

    const result = await system.execute(
      {
        id: "system-timeout",
        goal: "crea una carpeta llamada example y dentro un archivo readme que contenga un helloworld"
      },
      plan,
      {
        provider: hangingProvider
      }
    );

    expect(result.status).toBe("error");
    expect(result.summary).toContain("tardo demasiado en responder");
    expect(result.summary).toContain("No se ejecuto ningun comando del shell");
  });

  test("does not report success when the planner never produces a command", async () => {
    const system = new SystemAgent(() => createSystemClient([]), 50);

    const provider = new SequencedSystemProvider([
      JSON.stringify({ done: true, summary: "Hecho." }),
      JSON.stringify({ summary: "sin comando" }),
      JSON.stringify({})
    ]);

    const result = await system.execute(
      {
        id: "system-no-command",
        goal: "crea una carpeta llamada example y dentro un archivo readme que contenga un helloworld"
      },
      plan,
      {
        provider
      }
    );

    expect(result.status).toBe("error");
    expect(result.summary).toContain("No se ejecuto ningun comando del shell");
    expect(result.summary).toContain("no pudo planificar correctamente");
  });
});
