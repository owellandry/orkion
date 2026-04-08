import { c } from "../colors.ts";
import { write } from "../layout.ts";

const ASCII_LOGO = [
  " ▄▄▄   ▄▄▄ █  ▄ ▄  ▄▄▄  ▄▄▄▄  ",
  "█   █ █    █▄▀  ▄ █   █ █   █ ",
  "▀▄▄▄▀ █    █ ▀▄ █ ▀▄▄▄▀ █   █ ",
  "           █  █ █             "
];

export function printLogo(): void {
  for (const line of ASCII_LOGO) {
    write(`  ${c.bold}${c.brightCyan}${line}${c.reset}\n`);
  }
}
