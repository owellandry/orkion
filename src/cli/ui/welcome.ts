import { c } from "./colors.ts";
import { write } from "./layout.ts";

export function printCommandFeedback(key: string, value: string): void {
  write(`  ${c.gray}${key}${c.reset}  ${c.brightCyan}→${c.reset}  ${c.dim}${value}${c.reset}\n`);
}

export function printWelcome(): void {
  write("\n");
  write(`  ${c.bold}${c.brightWhite}Orkion CLI${c.reset} ${c.dim}v0.1.0${c.reset}\n`);
  write(`  ${c.dim}Use /provider, /model, /json, /verbose, or /exit${c.reset}\n`);
  write("\n");
}
