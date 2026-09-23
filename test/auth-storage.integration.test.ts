import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  AuthStorage,
  SqliteAuthCredentialStore,
  type Api,
  type Model,
  type OAuthCredential,
  type ProviderDefinition,
} from "@oh-my-pi/pi-ai";
import {
  registerOAuthProvider,
  unregisterOAuthProvider,
} from "@oh-my-pi/pi-ai/registry";
import { getOAuthProviders } from "@oh-my-pi/pi-ai/oauth";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import {
  buildCodexAlias,
  CODEX_DEVICE_PROVIDER_ID,
  type CodexDeps,
} from "../src/codex.js";
import type { AliasDefinition } from "../src/config.js";

const alias: AliasDefinition = {
  provider: "openai-codex",
  slug: "pro",
  label: "Codex Pro",
  providerId: "openai-codex-pro",
};

afterEach(() => {
  unregisterOAuthProvider(alias.providerId);
  unregisterOAuthProvider(`${alias.providerId}-device`);
});

function sourceModel(): Model<Api> {
  return {
    id: "gpt-5.5",
    name: "GPT-5.5",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    input: ["text"],
    cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 64_000,
    compat: {},
  } as unknown as Model<Api>;
}

describe("OMP AuthStorage integration", () => {
  test("runtime provider registration preserves the device alias credential target", () => {
    const database = new Database(":memory:");
    const store = new SqliteAuthCredentialStore(database);
    const auth = new AuthStorage(store);
    const registry = new ModelRegistry(auth);

    const built = buildCodexAlias(alias, {
      getProviderDefinition: (providerId) =>
        providerId === CODEX_DEVICE_PROVIDER_ID
          ? {
              id: CODEX_DEVICE_PROVIDER_ID,
              name: "ChatGPT Plus/Pro (Codex, headless/device)",
              login: async () => ({
                access: "device-access",
                refresh: "device-refresh",
                expires: Date.now() + 3_600_000,
              }),
            }
          : {
              id: "openai-codex",
              name: "ChatGPT Plus/Pro (Codex Subscription)",
              login: async () => ({
                access: "browser-access",
                refresh: "browser-refresh",
                expires: Date.now() + 3_600_000,
              }),
            },
      getBundledModels: () => [sourceModel()],
      fetchCodexModels: async () => ({ models: [] }),
      getCodexAccountId: () => undefined,
    });

    if (!built.device) throw new Error("alias device provider missing");
    registry.registerProvider(
      built.device.providerId,
      built.device.config as Parameters<ModelRegistry["registerProvider"]>[1],
      "test://omp-sub-alias",
    );

    const registered = getOAuthProviders().find(
      (provider) => provider.id === built.device!.providerId,
    );
    expect(registered?.storeCredentialsAs).toBe(alias.providerId);

    unregisterOAuthProvider(built.device.providerId);
    store.close();
  });

  test("login, refresh, and logout stay in the alias credential namespace", async () => {
    let refreshCount = 0;
    const definition: ProviderDefinition = {
      id: "openai-codex",
      name: "ChatGPT Plus/Pro (Codex Subscription)",
      login: async () => ({
        access: "alias-access",
        refresh: "alias-refresh",
        expires: Date.now() + 3_600_000,
        accountId: "alias-account",
      }),
      refreshToken: async (credentials) => {
        refreshCount += 1;
        return {
          ...credentials,
          access: "alias-refreshed",
          expires: Date.now() + 3_600_000,
        };
      },
    };
    const deviceDefinition: ProviderDefinition = {
      id: CODEX_DEVICE_PROVIDER_ID,
      name: "ChatGPT Plus/Pro (Codex, headless/device)",
      login: async () => ({
        access: "device-access",
        refresh: "device-refresh",
        expires: Date.now() + 3_600_000,
        accountId: "device-account",
      }),
      refreshToken: (credentials, signal) =>
      definition.refreshToken!(credentials, signal),
    };
    const deps: CodexDeps = {
      getProviderDefinition: (providerId) =>
        providerId === CODEX_DEVICE_PROVIDER_ID
          ? deviceDefinition
          : providerId === "openai-codex"
            ? definition
            : undefined,
      getBundledModels: () => [sourceModel()],
      fetchCodexModels: async () => ({ models: [] }),
      getCodexAccountId: () => undefined,
    };

    const built = buildCodexAlias(alias, deps);
    const oauth = built.config.oauth;
    if (!oauth) throw new Error("alias OAuth missing");

    registerOAuthProvider({
      ...oauth,
      id: alias.providerId,
    });
    if (!built.device?.config.oauth) {
      throw new Error("alias device OAuth missing");
    }
    registerOAuthProvider({
      ...built.device.config.oauth,
      id: built.device.providerId,
    } as Parameters<typeof registerOAuthProvider>[0]);

    const database = new Database(":memory:");
    const store = new SqliteAuthCredentialStore(database);
    const auth = new AuthStorage(store);

    const stock: OAuthCredential = {
      type: "oauth",
      access: "stock-access",
      refresh: "stock-refresh",
      expires: Date.now() + 3_600_000,
      accountId: "stock-account",
    };
    await auth.set("openai-codex", stock);

    await auth.login(built.device!.providerId, {
      onAuth() {},
      async onPrompt() {
        return "";
      },
    });
    expect(auth.get(built.device!.providerId)).toBeUndefined();
    expect(auth.get(alias.providerId)).toMatchObject({
      type: "oauth",
      access: "device-access",
      accountId: "device-account",
    });
    expect(auth.get("openai-codex")).toMatchObject({
      type: "oauth",
      access: "stock-access",
      accountId: "stock-account",
    });

    await auth.logout(alias.providerId);
    expect(auth.get(alias.providerId)).toBeUndefined();

    await auth.login(alias.providerId, {
      onAuth() {},
      async onPrompt() {
        return "";
      },
    });

    expect(auth.get("openai-codex")).toMatchObject({
      type: "oauth",
      access: "stock-access",
      accountId: "stock-account",
    });
    expect(auth.get(alias.providerId)).toMatchObject({
      type: "oauth",
      access: "alias-access",
      accountId: "alias-account",
    });

    const aliasCredential = auth.get(alias.providerId);
    if (!aliasCredential || aliasCredential.type !== "oauth") {
      throw new Error("alias OAuth credential missing");
    }
    await auth.set(alias.providerId, {
      ...aliasCredential,
      expires: Date.now() - 1,
    });

    expect(await auth.getApiKey(alias.providerId)).toBe("alias-refreshed");
    expect(refreshCount).toBe(1);
    expect(auth.get(alias.providerId)).toMatchObject({
      type: "oauth",
      access: "alias-refreshed",
    });
    expect(auth.get("openai-codex")).toMatchObject({
      type: "oauth",
      access: "stock-access",
    });

    await auth.logout(alias.providerId);

    expect(auth.get(alias.providerId)).toBeUndefined();
    expect(auth.get("openai-codex")).toMatchObject({
      type: "oauth",
      access: "stock-access",
      accountId: "stock-account",
    });

    store.close();
  });
});
