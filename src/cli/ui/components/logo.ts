import { c } from "../colors.ts";
import { write } from "../layout.ts";

const ASCII_LOGO = [
  " ██████╗ ██████╗ ██╗  ██╗██╗ ██████╗ ███╗   ██╗     ██████╗██╗     ██╗",
  "██╔═══██╗██╔══██╗██║ ██╔╝██║██╔═══██╗████╗  ██║    ██╔════╝██║     ██║",
  "██║   ██║██████╔╝█████╔╝ ██║██║   ██║██╔██╗ ██║    ██║     ██║     ██║",
  "██║   ██║██╔══██╗██╔═██╗ ██║██║   ██║██║╚██╗██║    ██║     ██║     ██║",
  "╚██████╔╝██║  ██║██║  ██╗██║╚██████╔╝██║ ╚████║    ╚██████╗███████╗██║",
  " ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝     ╚═════╝╚══════╝╚═╝"
];

export function printLogo(): void {
  const version = "v0.1.0";
  
  for (let i = 0; i < ASCII_LOGO.length; i++) {
    const line = ASCII_LOGO[i];
    
    // Alineamos la versión a la derecha de la última línea del logo
    if (i === ASCII_LOGO.length - 1) {
      write(`  ${c.bold}${c.brightCyan}${line}${c.reset}  ${c.dim}${version}${c.reset}\n`);
    } else {
      write(`  ${c.bold}${c.brightCyan}${line}${c.reset}\n`);
    }
  }
}
