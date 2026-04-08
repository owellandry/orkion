import type { CredentialResolver } from "../config/credential-resolver.ts";
import type { OrkionConfig, ProviderName } from "../config/types.ts";
import { OrkionConfigurationError } from "../errors/configuration-error.ts";
import { AnthropicProvider } from "./anthropic-provider.ts";
import { OpenAICompatibleProvider } from "./openai-compatible-provider.ts";
import type { LLMProvider, ProviderAvailability } from "./types.ts";

export type ProviderFactory = (provider: ProviderName, apiKey: string) => LLMProvider;

const PROVIDER_BASE_URLS: Record<Exclude<ProviderName, "anthropic">, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
  xai: "https://api.x.ai/v1"
};

export function createDefaultProviderFactory(): ProviderFactory {
  return (provider, apiKey) => {
    if (provider === "anthropic") {
      return new AnthropicProvider(apiKey);
    }

    return new OpenAICompatibleProvider({
      name: provider,
      apiKey,
      baseURL: PROVIDER_BASE_URLS[provider],
      maxRetries: 0,
      defaultHeaders:
        provider === "openrouter"
          ? {
              "HTTP-Referer": "https://orkion.local",
              "X-Title": "orkion"
            }
          : undefined
    });
  };
}

export class ProviderRegistry {
  constructor(
    private readonly config: OrkionConfig,
    private readonly credentials: CredentialResolver,
    private readonly providerFactory: ProviderFactory = createDefaultProviderFactory()
  ) {}

  listAvailability(): ProviderAvailability[] {
    return this.config.providerPriority.map((name) => {
      const providerConfig = this.config.providers[name];
      const hasCredentials = this.credentials.has(name);

      if (!providerConfig.enabled) {
        return {
          name,
          enabled: false,
          hasCredentials,
          available: false,
          reason: "Provider disabled in orkion.config.ts"
        };
      }

      if (!hasCredentials) {
        return {
          name,
          enabled: true,
          hasCredentials: false,
          available: false,
          reason: `Missing credentials for ${name}`
        };
      }

      return {
        name,
        enabled: true,
        hasCredentials: true,
        available: true
      };
    });
  }

  getAvailableProviderNames(): ProviderName[] {
    return this.listAvailability()
      .filter((provider) => provider.available)
      .map((provider) => provider.name);
  }

  createProvider(name: ProviderName): LLMProvider {
    const apiKey = this.credentials.get(name);
    if (!apiKey) {
      throw new OrkionConfigurationError(`No credentials found for provider "${name}".`);
    }

    return this.providerFactory(name, apiKey);
  }
}
