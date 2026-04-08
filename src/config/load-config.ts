import orkionConfig from "../../orkion.config.ts";
import type { OrkionConfig } from "./types.ts";

export function loadConfig(): OrkionConfig {
  return orkionConfig;
}
