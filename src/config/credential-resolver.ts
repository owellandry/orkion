import type { ProviderName } from "./types.ts";

export interface ProviderCredentials {
  openrouter?: string;
  openai?: string;
  anthropic?: string;
  xai?: string;
}

const PROVIDER_ENV_MAP: Record<ProviderName, string> = {
  openrouter: "OPENROUTER_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  xai: "XAI_API_KEY"
};

function readEnv(name: string): string | undefined {
  const hasProcessOverride = Object.prototype.hasOwnProperty.call(process.env, name);
  const value = hasProcessOverride ? process.env[name] : Bun.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export class CredentialResolver {
  resolve(): ProviderCredentials {
    return {
      openrouter: readEnv(PROVIDER_ENV_MAP.openrouter),
      openai: readEnv(PROVIDER_ENV_MAP.openai),
      anthropic: readEnv(PROVIDER_ENV_MAP.anthropic),
      xai: readEnv(PROVIDER_ENV_MAP.xai)
    };
  }

  get(provider: ProviderName): string | undefined {
    return this.resolve()[provider];
  }

  has(provider: ProviderName): boolean {
    return Boolean(this.get(provider));
  }
}

export function getModelEnvVar(provider: ProviderName): string | undefined {
  const envName = `${provider.toUpperCase()}_MODEL`;
  return readEnv(envName);
}
