import { describe, expect, test } from "bun:test";
import type { Api, Model, ProviderDefinition } from "@oh-my-pi/pi-ai";
import type { ProviderConfig } from "@oh-my-pi/pi-coding-agent";
import type { AliasDefinition } from "../src/config.js";
import {
  registerAliases,
  type AliasHost,
  type AliasRuntimeDeps,
} from "../src/register.js";

function sourceModel(id = "gpt-5.6-codex"): Model<Api> {
  return {
    id,
    name: id,
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

class FakeHost implements AliasHost {
  providers = new Map<string, ProviderConfig>();
  handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();

  registerProvider(name: string, config: ProviderConfig): void {
    this.providers.set(name, config);
  }

  unregisterProvider(name: string): void {
    this.providers.delete(name);
  }

  on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void {
    this.handlers.set(event, handler);
  }
}

function alias(slug: string): AliasDefinition {
  return {
    provider: "openai-codex",
    slug,
    label: slug === "pro" ? "Codex Pro" : "Codex Work",
    providerId: `openai-codex-${slug}`,
  };
}

function runtime(aliases: AliasDefinition[]): AliasRuntimeDeps {
  const definition: ProviderDefinition = {
    id: "openai-codex",
    name: "ChatGPT Plus/Pro (Codex Subscription)",
    login: async () => ({
      access: "access",
      refresh: "refresh",
      expires: Date.now() + 60_000,
    }),
    refreshToken: async (credentials) => credentials,
  };
  return {
    loadConfig: () => ({ aliases: [...aliases], errors: [], files: [] }),
    codex: {
      getProviderDefinition: (providerId) =>
        providerId === "openai-codex-device"
          ? {
              ...definition,
              id: "openai-codex-device",
              name: "ChatGPT Plus/Pro (Codex, headless/device)",
            }
          : definition,
      getBundledModels: () => [sourceModel()],
      fetchCodexModels: async () => ({ models: [] }),
      getCodexAccountId: () => undefined,
    },
  };
}

describe("registration", () => {
  test("registers openai-codex-pro and its headless device login", () => {
    const host = new FakeHost();
    registerAliases(host, runtime([alias("pro")]));
    expect(host.providers.has("openai-codex-pro")).toBe(true);
    expect(host.providers.has("openai-codex-pro-device")).toBe(true);
    expect(host.providers.has("openai-codex")).toBe(false);
  });

  test("registers multiple independent aliases", () => {
    const host = new FakeHost();
    registerAliases(host, runtime([alias("pro"), alias("work")]));
    expect([...host.providers.keys()].sort()).toEqual([
      "openai-codex-pro",
      "openai-codex-pro-device",
      "openai-codex-work",
      "openai-codex-work-device",
    ]);
    expect(host.providers.get("openai-codex-pro")?.oauth).not.toBe(
      host.providers.get("openai-codex-work")?.oauth,
    );
  });

  test("refreshes aliases from live host model metadata", () => {
    const host = new FakeHost();
    registerAliases(host, runtime([alias("pro")]));

    const live = sourceModel("gpt-live");
    host.handlers.get("session_start")?.({}, {
      cwd: "/tmp/project",
      modelRegistry: { getAll: () => [live] },
    });

    expect(host.providers.get("openai-codex-pro")?.models?.map((m) => m.id)).toEqual([
      "gpt-live",
    ]);
  });
});
