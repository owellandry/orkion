import type { ExecutionEvent, ManagerExecutionResult } from "../types/agent.ts";
import type { CliState } from "./args.ts";

function line(char = "-", width = 48): string {
  return char.repeat(width);
}

function label(scope: ExecutionEvent["scope"]): string {
  switch (scope) {
    case "manager":
      return "manager";
    case "agent":
      return "lyra";
    case "mcp":
      return "mcp";
    case "provider":
      return "model";
  }
}

export function printWelcome(): void {
  console.log("");
  console.log("Orkion CLI");
  console.log(line("="));
  console.log("/provider <name>  /model <name>  /json on|off  /verbose on|off  /exit");
  console.log("");
}

export class ConsoleRenderer {
  private streaming = false;
  private sawStream = false;
  private currentPhase = "";

  constructor(private readonly verbose = false) {}

  beginTask(goal: string): void {
    console.log("");
    console.log(line("="));
    console.log(`User: ${goal}`);
    console.log(line("="));
  }

  handle(event: ExecutionEvent): void {
    if (event.kind === "stream") {
      if (!this.streaming) {
        this.streaming = true;
        this.sawStream = true;
        console.log("");
        console.log("Assistant");
        console.log(line("-"));
      }

      process.stdout.write(event.chunk ?? "");
      return;
    }

    if (this.streaming) {
      process.stdout.write("\n");
      console.log(line("-"));
      this.streaming = false;
    }

    if (!this.verbose && event.kind !== "error") {
      const phase = this.phaseFor(event);
      if (phase && phase !== this.currentPhase) {
        this.currentPhase = phase;
        console.log(`${label(event.scope)}: ${phase}`);
      }
      return;
    }

    const prefix = `${label(event.scope)}:`;
    if (event.kind === "error") {
      console.log(`${prefix} ERROR ${event.message}`);
      return;
    }

    if (event.kind === "done") {
      console.log(`${prefix} DONE ${event.message}`);
      return;
    }

    console.log(`${prefix} ${event.message}`);
  }

  finish(result: ManagerExecutionResult, state: CliState): void {
    if (this.streaming) {
      process.stdout.write("\n");
      console.log(line("-"));
      this.streaming = false;
    }

    if (!this.sawStream && result.text.trim()) {
      console.log("");
      console.log("Assistant");
      console.log(line("-"));
      console.log(result.text.trim());
      console.log(line("-"));
    }

    if (state.json) {
      console.log("");
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log("");
    console.log("Summary");
    console.log(line("-"));
    console.log(`provider   : ${result.plan.provider}`);
    console.log(`model      : ${result.plan.model}`);
    console.log(`delegated  : ${result.delegated ? "yes" : "no"}`);

    if (result.workerResult) {
      console.log(`confidence : ${result.workerResult.confidence}`);
      console.log(`tools      : ${result.workerResult.toolCalls.length}`);
      console.log(`status     : ${result.workerResult.status}`);
    }

    if (result.plan.warnings.length > 0) {
      console.log(`warnings   : ${result.plan.warnings.join(" | ")}`);
    }

    if (result.workerResult && result.workerResult.confidence !== "high" && result.workerResult.sources.length > 0) {
      console.log(`sources    : ${result.workerResult.sources.map((source) => source.domain).join(", ")}`);
    }

    console.log("");
  }

  private phaseFor(event: ExecutionEvent): string {
    if (event.scope === "manager" && event.message.startsWith("Intencion detectada")) {
      return event.message;
    }

    if (event.scope === "manager" && event.message.includes("Delegando")) {
      return "delegacion";
    }

    if (event.scope === "agent" && event.message.startsWith("Ronda")) {
      return event.message;
    }

    if (event.scope === "agent" && event.message.includes("evidencia")) {
      return "evidencia suficiente";
    }

    if (event.scope === "agent" && event.message.includes("presupuesto")) {
      return "presupuesto agotado";
    }

    if (event.scope === "provider" && event.kind === "status") {
      return "sintesis final";
    }

    return "";
  }
}
