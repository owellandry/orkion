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

  write(`${theme.start}  ${c.bold}${c.brightWhite}Orkion CLI${c.reset} ${c.dim}v0.1.0${c.reset}\n`);
  write(`${theme.bar}  ${c.dim}Usa /provider, /model, /json, /verbose, o /exit${c.reset}\n`);
}
