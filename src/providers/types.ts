import type { ProviderName } from "../config/types.ts";

export interface ProviderCapabilities {
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
}

export interface GenerateTextRequest {
  systemPrompt?: string;
  prompt: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  onToken?: (chunk: string) => void;
}

export interface GenerateTextResult {
  text: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  raw?: unknown;
}

export interface LLMProvider {
  readonly name: ProviderName;
  readonly capabilities: ProviderCapabilities;
  isConfigured(): boolean;
  generateText(request: GenerateTextRequest): Promise<GenerateTextResult>;
  streamText(request: GenerateTextRequest): Promise<GenerateTextResult>;
}

export interface ProviderAvailability {
  name: ProviderName;
  enabled: boolean;
  hasCredentials: boolean;
  available: boolean;
  reason?: string;
}

export interface ProviderSelection {
  provider: ProviderName;
  model: string;
  fallbackUsed: boolean;
  warnings: string[];
}
