import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadAliasConfig,
  makeAliasDefinition,
} from "../src/config.js";

describe("config", () => {
  test("builds openai-codex-pro provider id", () => {
    expect(
      makeAliasDefinition({
        provider: "openai-codex",
        slug: "pro",
        label: "Codex Pro",
      }),
    ).toEqual({
      provider: "openai-codex",
      slug: "pro",
      label: "Codex Pro",
      providerId: "openai-codex-pro",
    });
  });

  test("rejects unsafe slugs", () => {
    expect(() =>
      makeAliasDefinition({ provider: "openai-codex", slug: "../pro" }),
    ).toThrow();
    expect(() =>
      makeAliasDefinition({ provider: "openai-codex", slug: "Pro" }),
    ).toThrow();
  });

  test("project config overrides the same alias from user config", () => {
    const root = mkdtempSync(join(tmpdir(), "omp-sub-alias-config-"));
    const homeFile = join(root, "home.json");
    const projectFile = join(root, "project.json");
    writeFileSync(
      homeFile,
      JSON.stringify({
        aliases: [
          { provider: "openai-codex", slug: "pro", label: "Old" },
          { provider: "openai-codex", slug: "work", label: "Work" },
        ],
      }),
    );
    writeFileSync(
      projectFile,
      JSON.stringify({
        aliases: [
          { provider: "openai-codex", slug: "pro", label: "Codex Pro" },
        ],
      }),
    );

    const loaded = loadAliasConfig({ paths: [homeFile, projectFile] });
    expect(loaded.errors).toEqual([]);
    expect(loaded.aliases.map((alias) => [alias.providerId, alias.label])).toEqual([
      ["openai-codex-pro", "Codex Pro"],
      ["openai-codex-work", "Work"],
    ]);
  });

  test("reports malformed files without throwing", () => {
    const root = mkdtempSync(join(tmpdir(), "omp-sub-alias-bad-"));
    const path = join(root, "bad.json");
    mkdirSync(root, { recursive: true });
    writeFileSync(path, "{broken");
    const loaded = loadAliasConfig({ paths: [path] });
    expect(loaded.aliases).toEqual([]);
    expect(loaded.errors).toHaveLength(1);
  });
});
