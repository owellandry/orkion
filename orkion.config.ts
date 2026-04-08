import type { OrkionConfig } from "./src/config/types.ts";

export const orkionConfig: OrkionConfig = {
  defaultProvider: "openrouter",
  providerPriority: ["openrouter", "openai", "anthropic", "xai"],
  providers: {
    openrouter: {
      enabled: true,
      defaultModel: "meta-llama/llama-3.3-8b-instruct:free",
      fallbackModel: "meta-llama/llama-3.3-8b-instruct:free",
      preferFreeModels: true
    },
    openai: {
      enabled: true,
      defaultModel: "gpt-4.1-mini",
      fallbackModel: "gpt-4.1-mini"
    },
    anthropic: {
      enabled: true,
      defaultModel: "claude-3-5-sonnet-latest",
      fallbackModel: "claude-3-5-haiku-latest"
    },
    xai: {
      enabled: true,
      defaultModel: "grok-3-mini",
      fallbackModel: "grok-3-mini"
    }
  }
};

export default orkionConfig;
