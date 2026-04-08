import { write, cursorUp, clearLine } from "../layout.ts";
import { phaseColor } from "./format.ts";
import { c } from "../colors.ts";
import { theme } from "../theme.ts";

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
export const SPINNER_MS = 80;

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
        this.frame = (this.frame + 1) % SPINNER_FRAMES.length;
        if (this.active) this.redraw();
      }, SPINNER_MS);
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
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    
    // Clear the one line used by the minimalist spinner
    cursorUp(1);
    clearLine(); 
    write("\n");
    cursorUp(1);

    this.title = "";
    this.detail = "";
  }

  private redraw(): void {
    if (!this.active && this.title === "") return;

    const frameChar = SPINNER_FRAMES[this.frame];
    const color = phaseColor(this.title);

    const detailPart = this.detail ? ` ${c.dim}(${this.detail})${c.reset}` : "";
    const line = `${theme.bar}  ${color}${frameChar}${c.reset}  ${c.bold}${this.title}${c.reset}${detailPart}`;

    if (this.active) {
      cursorUp(1);
    }

    clearLine(); write(line + "\n");
    this.active = true;
  }
}