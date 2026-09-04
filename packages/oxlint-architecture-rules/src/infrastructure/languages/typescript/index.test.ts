import * as path from "node:path";
import { fileURLToPath } from "node:url";

import * as Result from "effect/Result";
import { describe, expect, it } from "vitest";

import { typescriptLanguage } from "./index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");

const language = typescriptLanguage();

describe("typescriptLanguage", () => {
  it("names itself and the source extensions the walker should visit", () => {
    expect(language.id).toBe("typescript");
    expect(language.extensions).toEqual([".ts", ".tsx", ".mts", ".cts"]);
  });

  it("marks a declaration file as one no policy is written about", () => {
    const ignored = (file: string) => language.ignoredFiles.some((pattern) => pattern.test(file));
    expect(ignored("thing.d.ts")).toBe(true);
    expect(ignored("thing.d.mts")).toBe(true);
    expect(ignored("thing.ts")).toBe(false);
  });

  it("reads facts through the TypeScript parser", () => {
    const facts = language.extractor.factsOf("x.ts", `import { a } from "m";`);
    expect(facts.specifiers).toEqual(["m"]);
  });

  it("builds a resolver for one scope through that scope's tsconfig", () => {
    const resolver = language.makeResolver(repoRoot, {
      files: "^packages/",
      tsconfig: "tsconfig.resolve.json",
    });
    const resolved = resolver.resolve(
      "packages/oxlint-architecture-rules/src/adapters/oxlint/plugin.ts",
      "./config-loader.js",
    );
    expect(Result.isSuccess(resolved) && resolved.success.path).toBe(
      "packages/oxlint-architecture-rules/src/adapters/oxlint/config-loader.ts",
    );
  });
});
