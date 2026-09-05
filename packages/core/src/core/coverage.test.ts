import * as Result from "effect/Result";
import { describe, expect, it } from "vitest";

import { type Coverage, coverageOf, coverageShortfalls, fractionsOf } from "./coverage.js";
import { compileGraphRules } from "./graph.js";
import { compileImportRules } from "./imports.js";
import { compileMemberRules } from "./members.js";
import { compileStructure } from "./structure.js";
import { compileSurfaceRules } from "./surface.js";

const unwrap = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
};

const probe = { from: "src/core/zz.ts", to: "src/x.ts" };

const policy = {
  importRules: unwrap(
    compileImportRules([
      // An allowlist: no `to`, a `toNot`.
      { name: "core/imports", message: "…", probe, from: "^src/core/", toNot: ["^src/core/"] },
      // A prohibition: names a `to`. Bounds nothing on its own.
      { name: "deny", message: "…", probe, from: "^src/", to: "^src/secret/" },
    ]),
  ),
  structure: unwrap(
    compileStructure({
      folders: [
        {
          name: "core/layout",
          message: "…",
          probe: { path: "src/core/zz.ts" },
          folder: "^src/core$",
          files: "\\.ts$",
        },
        {
          name: "lib/layout",
          message: "…",
          probe: { path: "src/lib/zz.ts" },
          folder: "^src/lib$",
          files: "^.*$",
        },
      ],
    }),
  ),
  memberRules: unwrap(
    compileMemberRules([
      {
        name: "m",
        message: "…",
        probe: { from: "src/core/zz.ts", name: "x" },
        from: "^src/core/",
        subject: "calls",
      },
    ]),
  ),
  surfaceRules: unwrap(
    compileSurfaceRules([
      {
        name: "s",
        message: "…",
        probe: { from: "src/lib/zz.ts", sites: [{ name: "x", kind: "named" }] },
        from: "^src/lib/",
      },
    ]),
  ),
  graph: unwrap(
    compileGraphRules({
      cycles: [
        {
          name: "c",
          message: "…",
          probe: {
            edges: [
              ["src/core/a.ts", "src/core/b.ts"],
              ["src/core/b.ts", "src/core/a.ts"],
            ],
          },
          within: "^src/core/",
        },
      ],
    }),
  ),
};

const FILES = ["src/core/a.ts", "src/core/b.ts", "src/lib/c.ts", "src/other/d.ts"];

describe("coverageOf", () => {
  const found = coverageOf(policy, FILES);

  it("counts a file under an import allowlist, and not one under a prohibition alone", () => {
    expect(found.imports).toEqual({ covered: 2, total: 4 });
  });

  it("tells an enumerated folder from an open one from none", () => {
    expect(found.structure).toEqual({ enumerated: 2, open: 1, total: 4 });
  });

  it("counts the files each per-file family selects", () => {
    expect(found.members).toEqual({ covered: 2, total: 4 });
    expect(found.surface).toEqual({ covered: 1, total: 4 });
  });

  it("counts the files in a graph scope", () => {
    expect(found.graph).toEqual({ covered: 2, total: 4 });
  });

  it("reads an empty tree as fully covered, so a floor does not fail on nothing", () => {
    expect(fractionsOf(coverageOf(policy, [])).imports).toBe(1);
  });
});

describe("coverageShortfalls", () => {
  const found: Coverage = coverageOf(policy, FILES);

  it("reports each family under its floor, with the actual fraction", () => {
    expect(coverageShortfalls(found, { imports: 0.75, members: 0.5, surface: 0.5 })).toEqual([
      { family: "imports", actual: 0.5, floor: 0.75 },
      { family: "surface", actual: 0.25, floor: 0.5 },
    ]);
  });

  it("counts structure by enumerated folders only", () => {
    expect(coverageShortfalls(found, { structure: 0.75 })).toEqual([
      { family: "structure", actual: 0.5, floor: 0.75 },
    ]);
  });

  it("is quiet when no floor is stated", () => {
    expect(coverageShortfalls(found, {})).toEqual([]);
  });
});
