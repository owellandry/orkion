import { parseArgs } from "./args.ts";
import { OrkionConfigurationError } from "../errors/configuration-error.ts";
import { executeTask } from "./task.ts";
import { runInteractive } from "./repl.ts";
import { c } from "./ui/colors.ts";
import { PermissionStore } from "../runtime/permission-control.ts";

export async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  parsed.state.permissionStore = new PermissionStore(process.cwd());

  if (parsed.task) {
    await executeTask(parsed.task, parsed.state);
    return;
  }

  await runInteractive(parsed.state);
}

export function handleCliError(error: unknown): never {
  if (error instanceof OrkionConfigurationError) {
    process.stderr.write(`\n  ${c.brightRed}✗${c.reset}  ${c.bold}configuration error${c.reset}  ${c.dim}${error.message}${c.reset}\n\n`);
    process.exit(1);
  }

  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\n  ${c.brightRed}✗${c.reset}  ${c.bold}fatal error${c.reset}  ${c.dim}${msg}${c.reset}\n\n`);
  process.exit(1);
}
