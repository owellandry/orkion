import { c } from "./colors.ts";
import { cols, rule, write, box } from "./layout.ts";

export function printCommandFeedback(key: string, value: string): void {
  write(`  ${c.gray}${key}${c.reset}  ${c.brightCyan}→${c.reset}  ${c.dim}${value}${c.reset}\n`);
}

export function printWelcome(): void {
  const w = cols();
  write("\n");
  write(`  ${c.bold}${c.brightCyan}orkion${c.reset}  ${c.dim}AI agent runtime${c.reset}\n`);
  write(`  ${c.dim}${box.topLeft}${box.horizontal.repeat(w - 2)}${box.topRight}${c.reset}\n`);
  write(`  ${c.dim}${box.vertical}${c.reset} Comandos: ${c.gray}/provider${c.reset} ${c.dim}<name>${c.reset} ${c.gray}/model${c.reset} ${c.dim}<name>${c.reset} ${c.gray}/json${c.reset} ${c.gray}/verbose${c.reset} ${c.gray}/exit${c.reset}\n`);
  write(`  ${c.dim}${box.bottomLeft}${box.horizontal.repeat(w - 2)}${box.bottomRight}${c.reset}\n`);
  write("\n");
}
