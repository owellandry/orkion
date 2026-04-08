import type { Interface } from "node:readline/promises";
import { c } from "./ui/colors.ts";
import { theme } from "./ui/theme.ts";
import { write } from "./ui/layout.ts";
import type { PermissionDecision, PermissionPrompter, PermissionRequest } from "../runtime/permission-control.ts";

function printPermissionOptions(request: PermissionRequest): void {
  write(`${theme.bar}\n`);
  write(`${theme.bar}  ${c.bold}${c.brightYellow}permiso${c.reset} ${c.gray}|${c.reset} ${c.brightWhite}${request.title}${c.reset}\n`);
  write(`${theme.bar}  ${c.dim}${request.description}${c.reset}\n`);
  write(`${theme.bar}  ${c.gray}1${c.reset} ${c.dim}si${c.reset}\n`);
  write(`${theme.bar}  ${c.gray}2${c.reset} ${c.dim}si, no volver a preguntar${c.reset}\n`);
  write(`${theme.bar}  ${c.gray}3${c.reset} ${c.dim}no${c.reset}\n`);
}

function normalizeDecision(answer: string): PermissionDecision | undefined {
  const value = answer.trim().toLowerCase();
  if (value === "1" || value === "si" || value === "s") return "allow_once";
  if (value === "2") return "allow_always";
  if (value === "3" || value === "no" || value === "n") return "deny";
  return undefined;
}

export function createPermissionPrompter(rl: Interface): PermissionPrompter {
  return {
    async requestPermission(request: PermissionRequest): Promise<PermissionDecision> {
      while (true) {
        printPermissionOptions(request);
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
