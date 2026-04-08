import type { ExecutionEvent, ManagerExecutionResult } from "../types/agent.ts";
import type { CliState } from "./args.ts";

// ─── ANSI palette ─────────────────────────────────────────────────────────────

const c = {
  reset:        "\x1b[0m",
  bold:         "\x1b[1m",
  dim:          "\x1b[2m",
  italic:       "\x1b[3m",
  red:          "\x1b[31m",
  green:        "\x1b[32m",
  yellow:       "\x1b[33m",
  blue:         "\x1b[34m",
  magenta:      "\x1b[35m",
  cyan:         "\x1b[36m",
  gray:         "\x1b[90m",
  brightRed:    "\x1b[91m",
  brightGreen:  "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue:   "\x1b[94m",
  brightMagenta:"\x1b[95m",
  brightCyan:   "\x1b[96m",
  brightWhite:  "\x1b[97m",
} as const;

// Braille spinner — smooth 10-frame cycle
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const SPINNER_MS = 80;

// ─── Layout helpers ───────────────────────────────────────────────────────────

function cols(): number {
  return Math.min((process.stdout.columns ?? 80) - 2, 90);
}

function rule(width = cols()): string {
  return "─".repeat(Math.max(0, width));
}

function write(text: string): void {
  process.stdout.write(text);
}

// Move cursor to beginning of the line N lines above (CPL sequence)
function cursorUp(n: number): void {
  write(`\x1b[${n}F`);
}

// Clear from cursor to end of line
function clearLine(): void {
  write("\x1b[2K");
}

// ─── Phase helpers ────────────────────────────────────────────────────────────

function fallbackPhaseTitle(scope: ExecutionEvent["scope"]): string {
  switch (scope) {
    case "manager":  return "pensando";
    case "agent":    return "lyra investigando";
    case "mcp":      return ""; // MCP events only update the detail line
    case "provider": return "sintetizando";
  }
}

function phaseColor(title: string): string {
  if (title.includes("lyra") || title.includes("investigando")) return c.brightMagenta;
  if (title.includes("sinteti"))                                 return c.brightBlue;
  return c.brightCyan;
}

function normalizeStatus(event: ExecutionEvent): { title: string; detail: string } {
  const title  = typeof event.data?.title  === "string" ? event.data.title  : fallbackPhaseTitle(event.scope);
  const detail = typeof event.data?.detail === "string" ? event.data.detail : event.message;
  return { title, detail };
}

// ─── Source summary ───────────────────────────────────────────────────────────

function sourceSummary(domains: string[]): string {
  const counts = new Map<string, number>();
  for (const d of domains) counts.set(d, (counts.get(d) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([d, n]) => (n > 1 ? `${d} ×${n}` : d))
    .join("  ·  ");
}

// ─── Welcome ──────────────────────────────────────────────────────────────────

export function printCommandFeedback(key: string, value: string): void {
  write(`  ${c.gray}${key}${c.reset}  ${c.brightCyan}→${c.reset}  ${c.dim}${value}${c.reset}\n`);
}

export function printWelcome(): void {
  const w = cols();
  write("\n");
  write(`  ${c.bold}${c.brightCyan}orkion${c.reset}  ${c.dim}AI agent runtime${c.reset}\n`);
  write(`  ${c.dim}${rule(w)}${c.reset}\n`);
  write(
    `  ${c.gray}/provider${c.reset} ${c.dim}<name>${c.reset}` +
    `   ${c.gray}/model${c.reset} ${c.dim}<name>${c.reset}` +
    `   ${c.gray}/json${c.reset}` +
    `   ${c.gray}/verbose${c.reset}` +
    `   ${c.gray}/exit${c.reset}\n`
  );
  write("\n");
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

export class ConsoleRenderer {
  // Streaming state
  private streaming   = false;
  private sawStream   = false;
  private atLineStart = true;

  // Status block state (always 2 lines)
  private statusActive = false;
  private statusTitle  = "";
  private statusDetail = "";

  // Spinner
  private spinnerFrame   = 0;
  private spinnerTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly verbose = false) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  beginTask(goal: string): void {
    write("\n");
    write(`  ${c.bold}${c.brightCyan}you${c.reset}  ${c.gray}›${c.reset}  ${goal}\n`);
    write("\n");
  }

  handle(event: ExecutionEvent): void {
    // ── Streaming chunk ──────────────────────────────────────────────────
    if (event.kind === "stream") {
      this._clearStatus();
      if (!this.streaming) {
        this.streaming   = true;
        this.sawStream   = true;
        this.atLineStart = true;
        write(this._assistantHeader());
      }
      const chunk = event.chunk ?? "";
      if (chunk) {
        const prefix = this.atLineStart ? "  " : "";
        write(prefix + chunk.replace(/\n(?!$)/g, "\n  "));
        this.atLineStart = chunk.endsWith("\n");
      }
      return;
    }

    // ── Close streaming block ────────────────────────────────────────────
    if (this.streaming) {
      if (!this.atLineStart) write("\n");
      write(this._assistantFooter());
      this.streaming = false;
    }

    // ── Error ────────────────────────────────────────────────────────────
    if (event.kind === "error") {
      this._clearStatus();
      write(`\n  ${c.brightRed}✗${c.reset}  ${c.bold}${c.red}error${c.reset}  ${c.dim}${event.message}${c.reset}\n\n`);
      return;
    }

    // ── Done ─────────────────────────────────────────────────────────────
    if (event.kind === "done") {
      // Just let the status block clear naturally on next event or finish()
      this._stopSpinner();
      return;
    }

    // ── Verbose: raw event lines ─────────────────────────────────────────
    if (this.verbose) {
      this._clearStatus();
      this._printVerbose(event);
      return;
    }

    // ── Status / spinner ─────────────────────────────────────────────────
    const { title, detail } = normalizeStatus(event);

    if (!title) {
      // MCP / scope without a title → update detail only
      if (this.statusActive) this._updateStatus(this.statusTitle, detail);
      return;
    }

    this._updateStatus(title, detail);
  }

  finish(result: ManagerExecutionResult, state: CliState): void {
    this._clearStatus();

    if (this.streaming) {
      if (!this.atLineStart) write("\n");
      write(this._assistantFooter());
      this.streaming = false;
    }

    // Non-streaming fallback response block
    if (!this.sawStream && result.text.trim()) {
      write(this._assistantHeader());
      write(`  ${result.text.trim().split("\n").join("\n  ")}\n`);
      write(this._assistantFooter());
    }

    if (!result.text.trim() && !this.sawStream) {
      write(`\n  ${c.gray}◆  Sin respuesta generada.${c.reset}\n`);
    }

    if (state.json) {
      write("\n" + JSON.stringify(result, null, 2) + "\n");
      return;
    }

    this._printSummary(result);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _assistantHeader(): string {
    const title = ` assistant `;
    const left  = 3;
    const right = Math.max(0, cols() - left - title.length);
    return (
      `\n  ${c.dim}${rule(left)}${c.reset}` +
      `${c.bold}${c.brightWhite}${title}${c.reset}` +
      `${c.dim}${rule(right)}${c.reset}\n\n`
    );
  }

  private _assistantFooter(): string {
    return `\n  ${c.dim}${rule()}${c.reset}\n`;
  }

  // ── Status block (2 fixed lines, redrawn in-place) ─────────────────────────
  //
  //  Line 1:  "  {spinner}  {title}"
  //  Line 2:  "     {detail}"
  //
  // Both lines are always written so cursor-up math stays constant at 2.

  private _startSpinner(): void {
    if (this.spinnerTimer) return;
    this.spinnerTimer = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
      if (this.statusActive) this._redrawStatus();
    }, SPINNER_MS);
  }

  private _stopSpinner(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = undefined;
    }
  }

  private _updateStatus(title: string, detail: string): void {
    this.statusTitle  = title;
    this.statusDetail = detail;
    this._startSpinner();
    this._redrawStatus();
  }

  private _redrawStatus(): void {
    // Guard: if status was cleared between the interval being queued and firing, abort
    if (!this.statusActive && this.statusTitle === "") return;

    const frame = SPINNER_FRAMES[this.spinnerFrame];
    const color = phaseColor(this.statusTitle);

    const line1 = `  ${color}${frame}${c.reset}  ${c.bold}${this.statusTitle}${c.reset}`;
    const line2 = `     ${c.dim}${this.statusDetail}${c.reset}`;

    if (this.statusActive) {
      cursorUp(2);
    }

    clearLine(); write(line1 + "\n");
    clearLine(); write(line2 + "\n");

    this.statusActive = true;
  }

  private _clearStatus(): void {
    if (!this.statusActive) return;

    // Set flag FIRST — any interval tick already queued in the event loop
    // will see statusActive=false and abort before writing to stdout
    this.statusActive = false;
    this._stopSpinner();

    // Erase the 2 status lines
    cursorUp(2);
    clearLine(); write("\n");
    clearLine(); write("\n");
    cursorUp(2);

    this.statusTitle  = "";
    this.statusDetail = "";
  }

  // ── Verbose ────────────────────────────────────────────────────────────────

  private _printVerbose(event: ExecutionEvent): void {
    const scopeColors: Record<string, string> = {
      manager:  c.cyan,
      agent:    c.magenta,
      mcp:      c.yellow,
      provider: c.blue
    };
    const scopeNames: Record<string, string> = {
      manager:  "manager",
      agent:    "lyra",
      mcp:      "mcp",
      provider: "model"
    };
    const icon =
      event.kind === "done"  ? `${c.brightGreen}✓${c.reset}` :
      event.kind === "error" ? `${c.brightRed}✗${c.reset}`   :
      `${c.gray}◆${c.reset}`;

    const color = scopeColors[event.scope] ?? c.gray;
    const name  = (scopeNames[event.scope] ?? event.scope).padEnd(7);

    write(`  ${icon} ${c.bold}${color}${name}${c.reset}  ${c.dim}${event.message}${c.reset}\n`);
  }

  // ── Summary footer ─────────────────────────────────────────────────────────

  private _printSummary(result: ManagerExecutionResult): void {
    const workerStatus = result.workerResult?.status;
    const confidence   = result.workerResult?.confidence;
    const toolCount    = result.workerResult?.toolCalls.length ?? 0;
    const domains      = result.workerResult?.sources.map((s) => s.domain) ?? [];

    const statusBadge =
      workerStatus === "success" ? `${c.brightGreen}✓ éxito${c.reset}` :
      workerStatus === "error"   ? `${c.brightRed}✗ error${c.reset}`   : "";

    const confidenceBadge =
      confidence === "high"   ? `${c.brightGreen}alta${c.reset}`   :
      confidence === "medium" ? `${c.brightYellow}media${c.reset}` :
      confidence === "low"    ? `${c.yellow}baja${c.reset}`         : "";

    const sep = `  ${c.gray}·${c.reset}  `;

    // Main stats line
    const parts: string[] = [
      `${c.gray}${result.plan.provider}${c.reset}`,
      `${c.dim}${result.plan.model}${c.reset}`,
    ];
    if (toolCount > 0)    parts.push(`${c.gray}${toolCount} herr.${c.reset}`);
    if (statusBadge)      parts.push(statusBadge);
    if (confidenceBadge)  parts.push(`confianza ${confidenceBadge}`);
    if (result.plan.warnings.length > 0) {
      parts.push(`${c.yellow}⚠ ${result.plan.warnings.join(" · ")}${c.reset}`);
    }

    write(`\n  ${parts.join(sep)}\n`);

    // Sources line (only when confidence is not high)
    if (domains.length > 0 && confidence !== "high") {
      write(`\n  ${c.gray}fuentes${c.reset}  ${c.dim}${sourceSummary(domains)}${c.reset}\n`);
    }

    write("\n");
  }
}
