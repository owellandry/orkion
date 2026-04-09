import { c } from "./colors.ts";

export const theme = {
  prompt: `${c.brightGreen}➜${c.reset}`,
  agent: `${c.brightMagenta}✦${c.reset}`,
  success: `${c.brightGreen}✔${c.reset}`,
  error: `${c.brightRed}✖${c.reset}`,
  info: `${c.brightBlue}ℹ${c.reset}`,
  bullet: `${c.gray}•${c.reset}`,
  arrow: `${c.gray}→${c.reset}`,
  spinner: [`⠋`, `⠙`, `⠹`, `⠸`, `⠼`, `⠴`, `⠦`, `⠧`, `⠇`, `⠏`],
};