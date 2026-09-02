import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { listSourceFiles } from "./source-files.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

describe("listSourceFiles", () => {
  it("finds the sources under a root", () => {
    const files = listSourceFiles(repoRoot, ["packages/oxlint-architecture-rules/src/core"]);
    expect(files).toContain("packages/oxlint-architecture-rules/src/core/baseline.ts");
  });

  // A declaration file states types, not code; no linter visits one. The
  // fixture is written rather than pointed at a directory that happens to hold
  // a `.d.ts` today — a repository that stops emitting declarations beside its
  // sources would turn that into a test asserting nothing.
  it("skips declaration files", () => {
    const fixture = mkdtempSync(path.join(tmpdir(), "architecture-source-files-"));
    try {
      writeFileSync(path.join(fixture, "thing.ts"), "");
      writeFileSync(path.join(fixture, "thing.d.ts"), "");
      writeFileSync(path.join(fixture, "thing.d.mts"), "");
      expect(listSourceFiles(fixture, ["."])).toEqual(["thing.ts"]);
    } finally {
      rmSync(fixture, { force: true, recursive: true });
    }
  });

  it("skips the folders no policy is written about", () => {
    expect(
      listSourceFiles(repoRoot, ["packages/oxlint-architecture-rules"]).some((f) =>
        /node_modules|\/build\//.test(f),
      ),
    ).toBe(false);
  });
});

describe("roots", () => {
  // `architecture check <file>` is a reasonable thing to type, so a root that
  // names one file is that file rather than a directory to walk.
  it("takes a root that names a file as the file itself", () => {
    expect(
      listSourceFiles(repoRoot, ["packages/oxlint-architecture-rules/src/core/baseline.ts"]),
    ).toEqual(["packages/oxlint-architecture-rules/src/core/baseline.ts"]);
  });
});
