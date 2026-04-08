import { expect, test, describe } from "bun:test";
import { SystemAgent } from "../src/agents/system-agent.ts";
import type { TaskRequest } from "../src/types/agent.ts";

describe("SystemAgent", () => {
  test("canHandle detects system operations correctly", () => {
    const system = new SystemAgent(() => ({} as any));

    expect(system.canHandle({ goal: "ejecuta el comando ls" } as TaskRequest)).toBe(true);
    expect(system.canHandle({ goal: "crea una carpeta src" } as TaskRequest)).toBe(true);
    expect(system.canHandle({ goal: "abre la consola" } as TaskRequest)).toBe(true);
    expect(system.canHandle({ goal: "crea un archivo .env" } as TaskRequest)).toBe(true);
    
    // Debería ser falso para otras intenciones
    expect(system.canHandle({ goal: "quien es el presidente de francia" } as TaskRequest)).toBe(false);
    expect(system.canHandle({ goal: "calcula 2 + 2" } as TaskRequest)).toBe(false);
  });
});
