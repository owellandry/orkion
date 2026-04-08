import type { ExecutionEvent, ManagerExecutionResult } from "../../types/agent.ts";
import type { CliState } from "../args.ts";
import { c } from "./colors.ts";
import { write } from "./layout.ts";
import { Spinner } from "./components/spinner.ts";
import { normalizeStatus } from "./components/format.ts";
import { printSummary, printVerboseEvent } from "./components/summary.ts";
import { theme } from "./theme.ts";

export class ConsoleRenderer {
  private streaming = false;
  private sawStream = false;
  private atLineStart = true;
  private spinner = new Spinner();

  constructor(private readonly verbose = false) {}

  beginTask(goal: string): void {
    // Si viene de args es util, si no es REPL, mantenemos limpio
  }

  handle(event: ExecutionEvent): void {
    if (event.kind === "stream") {
      this.spinner.stop();
      if (!this.streaming) {
        this.streaming = true;
        this.sawStream = true;
        this.atLineStart = true;
        write(`${theme.bar}\n`);
        write(`${theme.bar}  ${c.bold}${c.brightMagenta}orkion${c.reset}\n`);
      }
      const chunk = event.chunk ?? "";
      if (chunk) {
        const prefix = this.atLineStart ? `${theme.bar}  ` : "";
        write(prefix + chunk.replace(/\n(?!$)/g, `\n${theme.bar}  `));
        this.atLineStart = chunk.endsWith("\n");
      }
      return;
    }

    if (this.streaming) {
      if (!this.atLineStart) write("\n");
      this.streaming = false;
    }

    if (event.kind === "error") {
      this.spinner.stop();
      write(`${theme.bar}\n`);
      write(`${theme.bar}  ${theme.error} ${c.brightRed}error${c.reset} ${c.dim}${event.message}${c.reset}\n`);
      return;
    }

    if (event.kind === "done") {
      this.spinner.stop();
      return;
    }

    if (this.verbose) {
      this.spinner.stop();
      printVerboseEvent(event);
      return;
    }

    const { title, detail } = normalizeStatus(event);

    if (!title) {
      this.spinner.update("", detail);
      return;
    }

    this.spinner.start(title, detail);
  }

  finish(result: ManagerExecutionResult, state: CliState): void {
    this.spinner.stop();

    if (this.streaming) {
      if (!this.atLineStart) write("\n");
      this.streaming = false;
    }

    if (!this.sawStream && result.text.trim()) {
      write(`${theme.bar}\n`);
      write(`${theme.bar}  ${c.bold}${c.brightMagenta}orkion${c.reset}\n`);
      write(`${theme.bar}  ${result.text.trim().split("\n").join(`\n${theme.bar}  `)}\n`);
    }

    if (!result.text.trim() && !this.sawStream) {
      write(`${theme.bar}\n`);
      write(`${theme.bar}  ${c.bold}${c.brightMagenta}orkion${c.reset}\n`);
      write(`${theme.bar}  ${c.gray}No se generó respuesta.${c.reset}\n`);
    }

    if (state.json) {
      write("\n" + JSON.stringify(result, null, 2) + "\n");
      return;
    }

    printSummary(result);
  }
}
