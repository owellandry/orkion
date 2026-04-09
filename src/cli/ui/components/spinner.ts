import { write, clearLine } from "../layout.ts";
import { phaseColor } from "./format.ts";
import { c } from "../colors.ts";
import { theme } from "../theme.ts";

export class Spinner {
  private active = false;
  private title = "";
  private detail = "";
  private frame = 0;
  private timer?: ReturnType<typeof setInterval>;

  start(title: string, detail: string): void {
    this.title = title;
    this.detail = detail;
    if (!this.timer) {
      this.timer = setInterval(() => {
        this.frame = (this.frame + 1) % theme.spinner.length;
        if (this.active) this.redraw();
      }, 80);
    }
    this.redraw();
  }

  update(title: string, detail: string): void {
    if (title) this.title = title;
    if (detail) this.detail = detail;
    this.redraw();
  }

  stop(): void {
    if (!this.active) return;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    clearLine();
    this.active = false;
    this.title = "";
    this.detail = "";
  }

  private redraw(): void {
    if (!this.title) return;

    const color = phaseColor(this.title);
    const frame = theme.spinner[this.frame];
    
    const detailPart = this.detail ? ` ${c.dim}(${this.detail})${c.reset}` : "";
    const line = `  ${color}${frame}${c.reset}  ${c.bold}${this.title}${c.reset}${detailPart}`;

    if (this.active) {
      clearLine();
      write(line);
      return;
    }

    write(line);
    this.active = true;
  }
}
