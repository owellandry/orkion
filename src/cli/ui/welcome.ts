import { c } from "./colors.ts";
import { write } from "./layout.ts";
import { theme } from "./theme.ts";
import { printLogo } from "./components/logo.ts";

export function printCommandFeedback(key: string, value: string): void {
  write(`${theme.bar}  ${c.gray}${key}${c.reset}  ${theme.arrow}  ${c.dim}${value}${c.reset}\n`);
}

export function printWelcome(): void {
  write("\n");
  
  printLogo();
  write("\n");

  write(`${theme.start}  ${c.dim}Usa /provider, /model, /json, /verbose, /clear, /compact, o /exit${c.reset}\n`);
}
