import { getProviderDefinition } from "@oh-my-pi/pi-ai/registry";
import { fetchCodexModels } from "@oh-my-pi/pi-catalog/discovery/codex";
import { getBundledModels } from "@oh-my-pi/pi-catalog/models";
import { getCodexAccountId } from "@oh-my-pi/pi-catalog/wire/codex";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { loadAliasConfig } from "./config.js";
import { registerAliases } from "./register.js";

export default function ompSubAlias(pi: ExtensionAPI): void {
  registerAliases(pi, {
    codex: {
      getProviderDefinition,
      getBundledModels: (providerId) =>
        getBundledModels(
          providerId as Parameters<typeof getBundledModels>[0],
        ),
      fetchCodexModels,
      getCodexAccountId,
    },
    loadConfig: loadAliasConfig,
  });
}

export {
  defaultConfigPaths,
  loadAliasConfig,
  makeAliasDefinition,
} from "./config.js";
export {
  buildCodexAlias,
  buildCodexDeviceAlias,
  CODEX_API,
  CODEX_DEVICE_PROVIDER_ID,
  CODEX_PROVIDER_ID,
  hydrateAliasModels,
  toProviderModelConfig,
} from "./codex.js";
export { registerAliases } from "./register.js";
