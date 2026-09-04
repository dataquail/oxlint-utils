import * as path from "node:path";
import { fileURLToPath } from "node:url";

import * as Result from "effect/Result";
import { describe, expect, it } from "vitest";

import type { ResolveConfig } from "../domain/architecture-config.js";
import { makeModuleResolverLive } from "./module-resolver-live.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

// Two scopes, because one is not enough to prove the dispatch works: a file
// under `website/` is resolved through the docs site's own tsconfig, not this
// package's.
const config: ResolveConfig = {
  scopes: [
    { files: "^packages/", tsconfig: "tsconfig.resolve.json" },
    { files: "^website/", tsconfig: "website/tsconfig.json" },
  ],
};

const resolver = makeModuleResolverLive(repoRoot, config);

const resolve = (fromFile: string, specifier: string) => {
  const outcome = resolver.resolve(fromFile, specifier);
  if (Result.isFailure(outcome)) throw outcome.failure;
  return outcome.success;
};

const PLUGIN_FILE = "packages/oxlint-architecture-rules/src/adapters/oxlint/plugin.ts";

describe("makeModuleResolverLive", () => {
  // Every one of these is a shape a real repository's imports take. A gap here
  // is not a missing feature — it is a rule that stops reporting.
  it("resolves a NodeNext relative specifier through its .js extension", () => {
    expect(resolve(PLUGIN_FILE, "./config-loader.js").path).toBe(
      "packages/oxlint-architecture-rules/src/adapters/oxlint/config-loader.ts",
    );
  });

  it("resolves a workspace package by name to its source barrel", () => {
    expect(resolve(PLUGIN_FILE, "oxlint-architecture-rules").path).toBe(
      "packages/oxlint-architecture-rules/src/index.ts",
    );
  });

  it("resolves a workspace package subpath to its source file", () => {
    expect(resolve(PLUGIN_FILE, "oxlint-architecture-rules/core/imports.js").path).toBe(
      "packages/oxlint-architecture-rules/src/core/imports.ts",
    );
  });

  it("resolves an npm subpath into node_modules and marks it external, by package name", () => {
    const target = resolve(PLUGIN_FILE, "effect/Schema");
    expect(target.kind).toBe("external");
    expect(target.package).toBe("effect");
    expect(target.path).toMatch(/node_modules\/effect\/dist\/Schema\.js$/);
  });

  it("does not report a package for a repository file", () => {
    expect(resolve(PLUGIN_FILE, "./config-loader.js").package).toBeUndefined();
  });

  // A builtin is its own kind: a rule fencing off npm dependencies must not
  // catch `node:crypto`.
  it("resolves a node builtin as its own dependency kind", () => {
    expect(resolve(PLUGIN_FILE, "node:crypto")).toEqual({ path: "node:crypto", kind: "builtin" });
  });

  it("fails on a specifier that resolves to nothing", () => {
    expect(Result.isFailure(resolver.resolve(PLUGIN_FILE, "nowhere-at-all"))).toBe(true);
  });

  it("fails on a file no resolve scope covers, rather than passing it silently", () => {
    expect(Result.isFailure(resolver.resolve("scripts/lint-rules/index.mjs", "node:path"))).toBe(
      true,
    );
  });

  it("resolves a file in a second scope through that scope's own tsconfig", () => {
    const target = resolve("website/src/content.config.ts", "@astrojs/starlight/loaders");
    expect(target.kind).toBe("external");
    expect(target.path).toMatch(/@astrojs\/starlight\/loaders\.ts$/);
  });

  // A scoped package is two path segments, and pnpm's store puts a second
  // `node_modules/` in front of the real one.
  it("names a scoped package by both segments, from the last node_modules on the path", () => {
    expect(resolve("website/src/content.config.ts", "@astrojs/starlight/loaders").package).toBe(
      "@astrojs/starlight",
    );
  });
});
