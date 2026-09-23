import type { Api, Model } from "@oh-my-pi/pi-ai";
import type { ProviderConfig } from "@oh-my-pi/pi-coding-agent";
import {
  buildCodexAlias,
  CODEX_PROVIDER_ID,
  type CodexDeps,
} from "./codex.js";
import {
  type AliasDefinition,
  type AliasLoadResult,
  type LoadConfigOptions,
} from "./config.js";

export interface AliasHost {
  registerProvider(name: string, config: ProviderConfig): void;
  unregisterProvider(name: string): void;
  on(
    event: "session_start" | "before_agent_start",
    handler: (event: unknown, ctx: unknown) => unknown,
  ): void;
}

export interface AliasRuntimeDeps {
  codex: CodexDeps;
  loadConfig(options?: LoadConfigOptions): AliasLoadResult;
}

type ModelRegistryLike = {
  getAll(): Model<Api>[];
};

type EventContextLike = {
  cwd?: string;
  hasUI?: boolean;
  modelRegistry?: ModelRegistryLike;
  ui?: {
    notify(message: string, level?: "info" | "warning" | "error"): void;
  };
};

export function registerAliases(
  pi: AliasHost,
  deps: AliasRuntimeDeps,
  initialCwd = process.cwd(),
): void {
  let registered = new Set<string>();
  let lastSignature = "";
  let lastErrorSignature = "";

  const refresh = (ctx?: EventContextLike) => {
    const cwd = ctx?.cwd ?? initialCwd;
    const loaded = deps.loadConfig({ cwd });
    const sourceModels = resolveSourceModels(ctx?.modelRegistry, deps.codex);
    const signature = registrationSignature(loaded.aliases, sourceModels);

    if (signature !== lastSignature) {
      const next = new Set<string>();

      for (const alias of loaded.aliases) {
        try {
          const adapter = adapterFor(alias, deps.codex, sourceModels);
          pi.registerProvider(alias.providerId, adapter);
          next.add(alias.providerId);
        } catch (error) {
          loaded.errors.push(
            `${alias.providerId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      for (const providerId of registered) {
        if (!next.has(providerId)) pi.unregisterProvider(providerId);
      }

      registered = next;
      lastSignature = signature;
    }

    reportErrors(loaded.errors, ctx);
  };

  const reportErrors = (errors: readonly string[], ctx?: EventContextLike) => {
    const signature = errors.join("\n");
    if (!signature || signature === lastErrorSignature) return;
    lastErrorSignature = signature;
    const message =
      errors.length === 1
        ? `omp-sub-alias: ${errors[0]}`
        : `omp-sub-alias: ${errors[0]} (+${errors.length - 1} more)`;

    if (ctx?.hasUI && ctx.ui) ctx.ui.notify(message, "error");
    else console.warn(message);
  };

  refresh();

  pi.on("session_start", (_event: unknown, ctx: unknown) =>
    refresh(asContext(ctx)),
  );
  pi.on("before_agent_start", (_event: unknown, ctx: unknown) =>
    refresh(asContext(ctx)),
  );
}

function adapterFor(
  alias: AliasDefinition,
  codex: CodexDeps,
  sourceModels: readonly Model<Api>[],
): ProviderConfig {
  if (alias.provider === CODEX_PROVIDER_ID) {
    return buildCodexAlias(alias, codex, sourceModels).config;
  }
  throw new Error(`unsupported provider: ${alias.provider}`);
}

function resolveSourceModels(
  registry: ModelRegistryLike | undefined,
  codex: CodexDeps,
): Model<Api>[] {
  const live =
    registry
      ?.getAll()
      .filter(
        (model) =>
          model.provider === CODEX_PROVIDER_ID &&
          model.api === "openai-codex-responses",
      ) ?? [];

  if (live.length > 0) return live;

  return codex
    .getBundledModels(CODEX_PROVIDER_ID)
    .filter(
      (model) =>
        model.provider === CODEX_PROVIDER_ID &&
        model.api === "openai-codex-responses",
    )
    .map((model) => structuredClone(model));
}

function registrationSignature(
  aliases: readonly AliasDefinition[],
  sourceModels: readonly Model<Api>[],
): string {
  return JSON.stringify({
    aliases,
    models: sourceModels,
  });
}

function asContext(value: unknown): EventContextLike | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as EventContextLike;
}
