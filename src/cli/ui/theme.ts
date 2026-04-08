import { c } from "./colors.ts";

export const theme = {
  bar: `${c.gray}│${c.reset}`,
  start: `${c.gray}┌${c.reset}`,
  end: `${c.gray}└${c.reset}`,
  step: `${c.brightCyan}◇${c.reset}`,
  active: `${c.brightCyan}◆${c.reset}`,
  success: `${c.brightGreen}◼${c.reset}`,
  error: `${c.brightRed}▲${c.reset}`,
  arrow: `${c.brightCyan}❯${c.reset}`,
};