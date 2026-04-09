import type { Interface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { stdin as input } from "node:process";
import { c } from "./ui/colors.ts";
import { theme } from "./ui/theme.ts";
import { clearLine, cursorUp, write } from "./ui/layout.ts";
import type { PermissionDecision, PermissionPrompter, PermissionRequest } from "../runtime/permission-control.ts";

const PERMISSION_OPTIONS: Array<{ label: string; decision: PermissionDecision }> = [
  { label: "si", decision: "allow_once" },
  { label: "si, no volver a preguntar", decision: "allow_always" },
  { label: "no", decision: "deny" }
];

function normalizeDecision(answer: string): PermissionDecision | undefined {
  const value = answer.trim().toLowerCase();
  if (value === "1" || value === "si" || value === "s") return "allow_once";
  if (value === "2") return "allow_always";
  if (value === "3" || value === "no" || value === "n") return "deny";
  return undefined;
}

function buildPermissionLines(request: PermissionRequest, selectedIndex: number): string[] {
  return [
    `${theme.bar}`,
    `${theme.bar}  ${c.bold}${c.brightYellow}permiso${c.reset} ${c.gray}|${c.reset} ${c.brightWhite}${request.title}${c.reset}`,
    `${theme.bar}  ${c.dim}${request.description}${c.reset}`,
    ...PERMISSION_OPTIONS.map((option, index) => {
      const active = index === selectedIndex;
      const marker = active ? `${c.brightCyan}>${c.reset}` : `${c.gray} ${c.reset}`;
      const label = active ? `${c.bold}${c.brightWhite}${option.label}${c.reset}` : `${c.dim}${option.label}${c.reset}`;
      return `${theme.bar}  ${marker} ${label}`;
    }),
    `${theme.bar}  ${c.dim}usa flechas arriba/abajo y Enter para confirmar${c.reset}`
  ];
}

function renderPermissionMenu(lines: string[], previousLineCount = 0): void {
  if (previousLineCount > 0) {
    cursorUp(previousLineCount);
    for (let index = 0; index < previousLineCount; index += 1) {
      clearLine();
      if (index < previousLineCount - 1) {
        write("\n");
      }
    }
    cursorUp(previousLineCount - 1);
  }

  write(lines.join("\n") + "\n");
}

async function requestPermissionWithArrows(request: PermissionRequest): Promise<PermissionDecision> {
  if (!input.isTTY) {
    return "deny";
  }

  emitKeypressEvents(input);
  input.setRawMode?.(true);
  input.resume();

  let selectedIndex = 0;
  let lineCount = 0;

  return await new Promise<PermissionDecision>((resolve) => {
    const cleanup = (): void => {
      input.setRawMode?.(false);
      input.removeListener("keypress", onKeypress);
    };

    const redraw = (): void => {
      const lines = buildPermissionLines(request, selectedIndex);
      renderPermissionMenu(lines, lineCount);
      lineCount = lines.length;
    };

    const onKeypress = (_chunk: string, key: { name?: string; sequence?: string; ctrl?: boolean }): void => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(130);
      }

      if (key.name === "up") {
        selectedIndex = (selectedIndex - 1 + PERMISSION_OPTIONS.length) % PERMISSION_OPTIONS.length;
        redraw();
        return;
      }

      if (key.name === "down") {
        selectedIndex = (selectedIndex + 1) % PERMISSION_OPTIONS.length;
        redraw();
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        const decision = PERMISSION_OPTIONS[selectedIndex]?.decision ?? "deny";
        cleanup();
        resolve(decision);
        return;
      }

      const typedDecision = normalizeDecision(key.sequence ?? "");
      if (typedDecision) {
        cleanup();
        resolve(typedDecision);
      }
    };

    input.on("keypress", onKeypress);
    redraw();
  });
}

export function createPermissionPrompter(rl: Interface): PermissionPrompter {
  return {
    async requestPermission(request: PermissionRequest): Promise<PermissionDecision> {
      if (input.isTTY) {
        rl.pause();
        const decision = await requestPermissionWithArrows(request);
        rl.resume();
        return decision;
      }

      while (true) {
        write(`${theme.bar}\n`);
        write(`${theme.bar}  ${c.bold}${c.brightYellow}permiso${c.reset} ${c.gray}|${c.reset} ${c.brightWhite}${request.title}${c.reset}\n`);
        write(`${theme.bar}  ${c.dim}${request.description}${c.reset}\n`);
        write(`${theme.bar}  ${c.gray}1${c.reset} ${c.dim}si${c.reset}\n`);
        write(`${theme.bar}  ${c.gray}2${c.reset} ${c.dim}si, no volver a preguntar${c.reset}\n`);
        write(`${theme.bar}  ${c.gray}3${c.reset} ${c.dim}no${c.reset}\n`);
        const answer = await rl.question(`${theme.bar}  ${theme.arrow} `);
        const decision = normalizeDecision(answer);
        if (decision) {
          return decision;
        }

        write(`${theme.bar}  ${c.brightRed}Opcion invalida.${c.reset} ${c.dim}Elige 1, 2 o 3.${c.reset}\n`);
      }
    }
  };
}
