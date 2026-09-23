import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AliasConfigEntry {
  provider: string;
  slug: string;
  label?: string;
}

export interface AliasDefinition {
  provider: string;
  slug: string;
  label: string;
  providerId: string;
}

export interface AliasLoadResult {
  aliases: AliasDefinition[];
  errors: string[];
  files: string[];
}

export interface LoadConfigOptions {
  cwd?: string;
  home?: string;
  paths?: readonly string[];
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function defaultConfigPaths(
  cwd = process.cwd(),
  home = homedir(),
): string[] {
  return [
    join(home, ".omp", "agent", "omp-sub-alias.json"),
    join(cwd, ".omp", "omp-sub-alias.json"),
  ];
}

export function makeAliasDefinition(
  entry: AliasConfigEntry,
  index = 0,
): AliasDefinition {
  if (!entry || typeof entry !== "object") {
    throw new Error(`aliases[${index}] must be an object`);
  }
  const provider = entry.provider?.trim();
  const slug = entry.slug?.trim();
  const label = entry.label?.trim();

  if (!provider) throw new Error(`aliases[${index}].provider is required`);
  if (!slug || !SLUG_RE.test(slug)) {
    throw new Error(
      `aliases[${index}].slug must match ${SLUG_RE.source}`,
    );
  }

  return {
    provider,
    slug,
    label: label || slug,
    providerId: `${provider}-${slug}`,
  };
}

export function loadAliasConfig(options: LoadConfigOptions = {}): AliasLoadResult {
  const paths =
    options.paths ??
    defaultConfigPaths(options.cwd ?? process.cwd(), options.home ?? homedir());
  const byProviderId = new Map<string, AliasDefinition>();
  const errors: string[] = [];
  const files: string[] = [];

  for (const path of paths) {
    if (!existsSync(path)) continue;
    files.push(path);

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      errors.push(`${path}: ${messageOf(error)}`);
      continue;
    }

    if (!isRecord(parsed) || !Array.isArray(parsed.aliases)) {
      errors.push(`${path}: expected {"aliases": [...]}`);
      continue;
    }

    for (let index = 0; index < parsed.aliases.length; index++) {
      const value = parsed.aliases[index];
      if (!isRecord(value)) {
        errors.push(`${path}: aliases[${index}] must be an object`);
        continue;
      }

      try {
        const alias = makeAliasDefinition(
          {
            provider:
              typeof value.provider === "string" ? value.provider : "",
            slug: typeof value.slug === "string" ? value.slug : "",
            ...(typeof value.label === "string" ? { label: value.label } : {}),
          },
          index,
        );
        byProviderId.set(alias.providerId, alias);
      } catch (error) {
        errors.push(`${path}: ${messageOf(error)}`);
      }
    }
  }

  return { aliases: [...byProviderId.values()], errors, files };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
