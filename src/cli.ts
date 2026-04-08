import { handleCliError, main } from "./cli/app.ts";

main().catch(handleCliError);
