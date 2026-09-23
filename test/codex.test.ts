import { describe, expect, test } from "bun:test";
import type {
  Api,
  Model,
  ModelSpec,
  OAuthCredentials,
  ProviderDefinition,
} from "@oh-my-pi/pi-ai";
import {
  buildCodexAlias,
  hydrateAliasModels,
  type CodexDeps,
} from "../src/codex.js";
import type { AliasDefinition } from "../src/config.js";

const alias: AliasDefinition = {
  provider: "openai-codex",
  slug: "pro",
  label: "Codex Pro",
  providerId: "openai-codex-pro",
};

function model(overrides: Record<string, unknown> = {}): Model<Api> {
  return {
    id: "gpt-5.6-codex",
    requestModelId: "gpt-5.6-codex-wire",
    reasoningMode: "pro",
    name: "GPT-5.6 Codex",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    thinking: { mode: "openai", efforts: ["low", "medium", "high"] },
    input: ["text", "image"],
    supportsTools: true,
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 64_000,
    preferWebsockets: true,
    compat: {},
    ...overrides,
  } as unknown as Model<Api>;
}

function deps(
  overrides: Partial<CodexDeps> = {},
): CodexDeps {
  const definition: ProviderDefinition = {
    id: "openai-codex",
    name: "ChatGPT Plus/Pro (Codex Subscription)",
    login: async () => ({
      access: "access-a",
      refresh: "refresh-a",
      expires: Date.now() + 60_000,
      accountId: "acct-a",
    }),
    refreshToken: async (credentials) => ({
      ...credentials,
      access: `${credentials.access}-refreshed`,
    }),
  };

  return {
    getProviderDefinition: () => definition,
    getBundledModels: () => [model()],
    fetchCodexModels: async () => ({ models: [] }),
    getCodexAccountId: () => undefined,
    ...overrides,
  };
}

describe("codex adapter", () => {
  test("registers native Codex API models and OAuth", () => {
    const built = buildCodexAlias(alias, deps(), [model()]);
    expect(built.config.api).toBe("openai-codex-responses");
    expect(built.config.oauth?.name).toContain("Codex Pro");
    expect(built.config.models?.[0]?.id).toBe("gpt-5.6-codex");
    expect(built.config.models?.[0]?.preferWebsockets).toBe(true);
  });

  test("skips non-chat catalog entries the extension model API cannot represent", () => {
    const built = buildCodexAlias(alias, deps(), [
      model(),
      model({
        id: "gpt-image-1",
        kind: "image",
        contextWindow: null,
        maxTokens: null,
      }),
    ]);

    expect(built.config.models?.map((entry) => entry.id)).toEqual([
      "gpt-5.6-codex",
    ]);
  });

  test("restores full source metadata after OMP custom-model projection", () => {
    const source = model();
    const projected = model({
      provider: "openai-codex-pro",
      requestModelId: undefined,
      reasoningMode: undefined,
      supportsTools: undefined,
    });
    const hydrated = hydrateAliasModels(
      [projected],
      alias,
      new Map([[source.id, source]]),
    )[0] as Model<Api> & {
      requestModelId?: string;
      reasoningMode?: string;
      supportsTools?: boolean;
    };

    expect(hydrated.provider).toBe("openai-codex-pro");
    expect(hydrated.requestModelId).toBe("gpt-5.6-codex-wire");
    expect(hydrated.reasoningMode).toBe("pro");
    expect(hydrated.supportsTools).toBe(true);
    expect(hydrated.preferWebsockets).toBe(true);
    expect(hydrated.name).toBe("GPT-5.6 Codex (Codex Pro)");
  });

  test("registers bundled Codex models before a session exposes the host registry", () => {
    const built = buildCodexAlias(alias, deps());
    expect(built.config.oauth?.name).toContain("Codex Pro");
    expect(built.config.api).toBe("openai-codex-responses");
    expect(built.config.models?.map((entry) => entry.id)).toEqual([
      "gpt-5.6-codex",
    ]);
    expect(built.config.fetchDynamicModels).toBeFunction();
  });

  test("discovers account-scoped models with the alias access token", async () => {
    let seenAccessToken = "";
    let seenAccountId: string | undefined;

    const built = buildCodexAlias(
      alias,
      deps({
        getCodexAccountId: (accessToken) => {
          expect(accessToken).toBe("alias-access");
          return "acct-alias";
        },
        fetchCodexModels: async (options) => {
          seenAccessToken = options.accessToken;
          seenAccountId = options.accountId;
          return {
            models: [
              model({
                id: "gpt-account-only",
                name: "GPT Account Only",
              }) as unknown as ModelSpec<"openai-codex-responses">,
            ],
          };
        },
      }),
    );

    const dynamic = await built.config.fetchDynamicModels!("alias-access");

    expect(seenAccessToken).toBe("alias-access");
    expect(seenAccountId).toBe("acct-alias");
    expect(dynamic.map((entry) => entry.id)).toEqual(["gpt-account-only"]);
  });

  test("does not redirect alias credentials back to stock provider", async () => {
    const built = buildCodexAlias(alias, deps());
    const oauth = built.config.oauth!;
    expect("storeCredentialsAs" in oauth).toBe(false);

    const stock: OAuthCredentials = {
      access: "stock-access",
      refresh: "stock-refresh",
      expires: Date.now() + 60_000,
    };
    const namespaces = new Map<string, OAuthCredentials>([
      ["openai-codex", stock],
    ]);

    const loggedIn = (await oauth.login({} as never)) as OAuthCredentials;
    namespaces.set(alias.providerId, loggedIn);

    const refreshed = await oauth.refreshToken!(namespaces.get(alias.providerId)!);
    namespaces.set(alias.providerId, refreshed);

    expect(namespaces.get("openai-codex")).toEqual(stock);
    expect(namespaces.get(alias.providerId)?.access).toBe("access-a-refreshed");

    namespaces.delete(alias.providerId);
    expect(namespaces.has(alias.providerId)).toBe(false);
    expect(namespaces.get("openai-codex")).toEqual(stock);
  });
});
