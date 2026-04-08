import { write, clearLine } from "../layout.ts";
import { phaseColor } from "./format.ts";
import { c } from "../colors.ts";
import { theme } from "../theme.ts";

export class Spinner {
  private active = false;
  private title = "";

  start(title: string, detail: string): void {
    this.title = title;
    this.redraw();
  }

  update(title: string, detail: string): void {
    if (title) this.title = title;
    this.redraw();
  }

  stop(): void {
    if (!this.active) return;
    clearLine();
    this.active = false;
    this.title = "";
  }

  private redraw(): void {
    if (!this.title) return;

    const color = phaseColor(this.title);
    const line = `${theme.bar}  ${c.bold}${c.brightMagenta}orkion${c.reset} ${c.gray}|${c.reset} ${color}${this.title}${c.reset}`;
    clearLine();
    write(line);
    this.active = true;
  }
}
