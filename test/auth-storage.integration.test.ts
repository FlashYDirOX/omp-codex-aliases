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
import { buildCodexAlias, type CodexDeps } from "../src/codex.js";
import type { AliasDefinition } from "../src/config.js";

const alias: AliasDefinition = {
  provider: "openai-codex",
  slug: "pro",
  label: "Codex Pro",
  providerId: "openai-codex-pro",
};

afterEach(() => {
  unregisterOAuthProvider(alias.providerId);
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
    const deps: CodexDeps = {
      getProviderDefinition: () => definition,
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
