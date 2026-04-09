export type ProviderName = "openrouter" | "openai" | "anthropic" | "xai" | "groq";

export interface ProviderConfig {
  enabled: boolean;
  defaultModel?: string;
  fallbackModel?: string;
  preferFreeModels?: boolean;
}

export interface OrkionConfig {
  defaultProvider: ProviderName;
  providerPriority: ProviderName[];
  providers: Record<ProviderName, ProviderConfig>;
}
