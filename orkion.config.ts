import type { OrkionConfig } from "./src/config/types.ts";

export const orkionConfig: OrkionConfig = {
  defaultProvider: "openrouter",
  providerPriority: ["openrouter", "openai", "anthropic", "xai", "groq"],
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
    },
    groq: {
      enabled: true,
      defaultModel: "llama-3.3-70b-versatile",
      fallbackModel: "llama-3.1-8b-instant"
    }
  }
};

export default orkionConfig;
