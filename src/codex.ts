import type {
  Api,
  Model,
  ModelSpec,
  OAuthCredentials,
  ProviderDefinition,
} from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import type {
  ProviderConfig,
  ProviderModelConfig,
} from "@oh-my-pi/pi-coding-agent";
import type { AliasDefinition } from "./config.js";

export const CODEX_PROVIDER_ID = "openai-codex";
export const CODEX_DEVICE_PROVIDER_ID = "openai-codex-device";
export const CODEX_API = "openai-codex-responses" as Api;

type CodexModelSpec = ModelSpec<"openai-codex-responses">;

export interface CodexDiscoveryResult {
  models: CodexModelSpec[];
  rejectedStatus?: 401 | 403;
}

export interface CodexDeps {
  getProviderDefinition(providerId: string): ProviderDefinition | undefined;
  getBundledModels(providerId: string): readonly Model<Api>[];
  fetchCodexModels(options: {
    accessToken: string;
    accountId?: string;
    baseUrl?: string;
  }): Promise<CodexDiscoveryResult | null>;
  getCodexAccountId(accessToken: string): string | undefined;
}

export interface CodexDeviceAliasBuild {
  providerId: string;
  config: ProviderConfig;
}

export interface CodexAliasBuild {
  config: ProviderConfig;
  sourceModels: ReadonlyMap<string, Model<Api>>;
  device?: CodexDeviceAliasBuild;
}

type ExtensionOAuthConfig = NonNullable<ProviderConfig["oauth"]> & {
  storeCredentialsAs?: string;
};

export function buildCodexAlias(
  alias: AliasDefinition,
  deps: CodexDeps,
  sourceModelsInput?: readonly Model<Api>[],
): CodexAliasBuild {
  if (alias.provider !== CODEX_PROVIDER_ID) {
    throw new Error(`unsupported provider: ${alias.provider}`);
  }

  const definition = deps.getProviderDefinition(CODEX_PROVIDER_ID);
  if (!definition?.login) {
    throw new Error("OMP exposes no openai-codex OAuth login flow");
  }
  const deviceDefinition = deps.getProviderDefinition(CODEX_DEVICE_PROVIDER_ID);

  const seedModels =
    sourceModelsInput ?? deps.getBundledModels(CODEX_PROVIDER_ID);
  const sourceModels = new Map(
    seedModels
      .filter(isRegisterableCodexModel)
      .map((model) => [model.id, cloneModel(model)]),
  );

  const oauth: ExtensionOAuthConfig = {
    name: `${definition.name} — ${alias.label}`,
    login: (callbacks) => definition.login!(callbacks),
    ...(definition.refreshToken
      ? {
          refreshToken: (
            credentials: OAuthCredentials,
            signal?: AbortSignal,
          ) => definition.refreshToken!(credentials, signal),
        }
      : {}),
    ...(definition.getApiKey
      ? {
          getApiKey: (credentials: OAuthCredentials) =>
            definition.getApiKey!(credentials),
        }
      : {
          getApiKey: (credentials: OAuthCredentials) => credentials.access,
        }),
    modifyModels: (models: Model<Api>[]) =>
      hydrateAliasModels(models, alias, sourceModels),
  };

  const models = [...sourceModels.values()];
  if (models.length === 0) {
    throw new Error("OMP exposes no registerable bundled openai-codex models");
  }

  const device =
    deviceDefinition?.login
      ? buildCodexDeviceAlias(alias, deviceDefinition)
      : undefined;

  const baseUrl = models[0]!.baseUrl;
  return {
    config: {
      baseUrl,
      api: CODEX_API,
      models: models.map((model) =>
        toProviderModelConfig(model, alias.label),
      ),
      oauth,
      fetchDynamicModels: async (apiKey) => {
        if (!apiKey) return [];

        const accountId = deps.getCodexAccountId(apiKey);
        const result = await deps.fetchCodexModels({
          accessToken: apiKey,
          ...(accountId ? { accountId } : {}),
          baseUrl,
        });
        if (!result || result.rejectedStatus !== undefined) return [];

        return result.models.flatMap((modelSpec) => {
          const fullModel = buildModel(modelSpec) as Model<Api>;
          if (!isRegisterableCodexModel(fullModel)) return [];
          sourceModels.set(fullModel.id, cloneModel(fullModel));
          return [toProviderModelConfig(fullModel, alias.label)];
        });
      },
    },
    sourceModels,
    ...(device ? { device } : {}),
  };
}

export function buildCodexDeviceAlias(
  alias: AliasDefinition,
  definition: ProviderDefinition,
): CodexDeviceAliasBuild {
  if (!definition.login) {
    throw new Error("OMP exposes no openai-codex device OAuth login flow");
  }

  const providerId = `${alias.providerId}-device`;
  const oauth: ExtensionOAuthConfig = {
    name: `${definition.name} — ${alias.label}`,
    login: (callbacks) => definition.login!(callbacks),
    ...(definition.refreshToken
      ? {
          refreshToken: (credentials: OAuthCredentials) =>
            definition.refreshToken!(credentials),
        }
      : {}),
    ...(definition.getApiKey
      ? {
          getApiKey: (credentials: OAuthCredentials) =>
            definition.getApiKey!(credentials),
        }
      : {
          getApiKey: (credentials: OAuthCredentials) => credentials.access,
        }),
    storeCredentialsAs: alias.providerId,
  };

  return { providerId, config: { oauth } };
}

export function hydrateAliasModels(
  models: Model<Api>[],
  alias: AliasDefinition,
  sourceModels: ReadonlyMap<string, Model<Api>>,
): Model<Api>[] {
  return models.map((model) => {
    if (model.provider !== alias.providerId) return model;

    const source = sourceModels.get(model.id);
    if (!source) return model;

    const hydrated = cloneModel(source);
    return {
      ...hydrated,
      provider: alias.providerId,
      name: aliasModelName(source.name, alias.label),
      baseUrl: model.baseUrl || source.baseUrl,
      api: source.api,
      isOAuth: true,
    } as Model<Api>;
  });
}

export function toProviderModelConfig(
  model: Model<Api>,
  label: string,
): ProviderModelConfig {
  if (model.contextWindow === null || model.maxTokens === null) {
    throw new Error(
      `Codex model ${model.id} is missing concrete context/output limits`,
    );
  }

  return {
    id: model.id,
    name: aliasModelName(model.name, label),
    api: model.api,
    reasoning: model.reasoning,
    ...(model.thinking ? { thinking: cloneValue(model.thinking) } : {}),
    input: [...model.input],
    cost: {
      input: model.cost.input,
      output: model.cost.output,
      cacheRead: model.cost.cacheRead,
      cacheWrite: model.cost.cacheWrite,
    },
    ...(model.premiumMultiplier !== undefined
      ? { premiumMultiplier: model.premiumMultiplier }
      : {}),
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    ...(model.preferWebsockets !== undefined
      ? { preferWebsockets: model.preferWebsockets }
      : {}),
    ...(model.headers ? { headers: { ...model.headers } } : {}),
    ...(model.compat
      ? {
          compat: cloneValue(
            model.compat,
          ) as ProviderModelConfig["compat"],
        }
      : {}),
  };
}

function isRegisterableCodexModel(model: Model<Api>): boolean {
  return (
    model.provider === CODEX_PROVIDER_ID &&
    model.api === CODEX_API &&
    model.contextWindow !== null &&
    model.maxTokens !== null
  );
}

function aliasModelName(name: string, label: string): string {
  return `${name} (${label})`;
}

function cloneModel<T extends Model<Api>>(model: T): T {
  return cloneValue(model);
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}
