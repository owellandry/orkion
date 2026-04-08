import { getModelEnvVar } from "../config/credential-resolver.ts";
import type { OrkionConfig, ProviderName } from "../config/types.ts";
import { OrkionConfigurationError } from "../errors/configuration-error.ts";
import type { ProviderRegistry } from "./provider-registry.ts";
import type { ProviderSelection } from "./types.ts";

function uniqueProviders(provider: ProviderName, rest: ProviderName[]): ProviderName[] {
  return [provider, ...rest.filter((candidate) => candidate !== provider)];
}

export class ModelPolicyResolver {
  constructor(
    private readonly config: OrkionConfig,
    private readonly registry: ProviderRegistry
  ) {}

  resolve(options?: {
    preferredProvider?: ProviderName;
    preferredModel?: string;
  }): ProviderSelection {
    const preferredProvider = options?.preferredProvider ?? this.config.defaultProvider;
    const preferredModel = options?.preferredModel;
    const availability = this.registry.listAvailability();
    const availableNames = availability
      .filter((provider) => provider.available)
      .map((provider) => provider.name);

    if (availableNames.length === 0) {
      const reasons = availability.map((provider) => `${provider.name}: ${provider.reason ?? "unavailable"}`);
      throw new OrkionConfigurationError(
        `No hay providers configurados. Revisa tus keys en .env. Estado: ${reasons.join("; ")}`
      );
    }

    const orderedCandidates = uniqueProviders(preferredProvider, this.config.providerPriority);
    const selectedProvider =
      orderedCandidates.find((provider) => availableNames.includes(provider)) ?? availableNames[0];

    const warnings: string[] = [];
    const fallbackUsed = selectedProvider !== preferredProvider;

    if (fallbackUsed) {
      warnings.push(
        `Provider "${preferredProvider}" no estaba disponible. Se usará "${selectedProvider}" como fallback.`
      );
    }

    const model = this.resolveModel(selectedProvider, {
      preferredProvider,
      preferredModel
    });

    if (preferredModel && selectedProvider !== preferredProvider) {
      warnings.push(
        `El modelo "${preferredModel}" no se pudo conservar al cambiar de provider. Se eligió "${model}".`
      );
    }

    return {
      provider: selectedProvider,
      model,
      fallbackUsed,
      warnings
    };
  }

  private resolveModel(
    selectedProvider: ProviderName,
    options: {
      preferredProvider?: ProviderName;
      preferredModel?: string;
    }
  ): string {
    if (options.preferredProvider === selectedProvider && options.preferredModel) {
      return options.preferredModel;
    }

    const envOverride = getModelEnvVar(selectedProvider);
    if (envOverride) {
      return envOverride;
    }

    const providerConfig = this.config.providers[selectedProvider];

    if (selectedProvider === "openrouter" && providerConfig.preferFreeModels) {
      return providerConfig.fallbackModel ?? providerConfig.defaultModel ?? "meta-llama/llama-3.3-8b-instruct:free";
    }

    const resolvedModel = providerConfig.defaultModel ?? providerConfig.fallbackModel;
    if (!resolvedModel) {
      throw new OrkionConfigurationError(`No model configured for provider "${selectedProvider}".`);
    }

    return resolvedModel;
  }
}
