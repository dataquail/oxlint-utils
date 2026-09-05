import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { makeFileSystemLive } from "./file-system-live.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("makeFileSystemLive", () => {
  const fileSystem = makeFileSystemLive(repoRoot);

  it("answers for a path that exists", () => {
    expect(fileSystem.exists("packages/core/package.json")).toBe(true);
  });

  it("answers for a path that does not", () => {
    expect(fileSystem.exists("packages/core/nowhere.json")).toBe(false);
  });

  it("reads a file's text, and null for one that is not there", () => {
    expect(fileSystem.readText("packages/core/package.json")).toContain(
      '"name": "@goodbones/core"',
    );
    expect(fileSystem.readText("packages/core/nowhere.json")).toBeNull();
  });

  // Every handler in a folder asks about the same `../../infrastructure/...`
  // shape, so a repeated question must not become a repeated syscall.
  it("gives the same answer from its cache on a repeat question", () => {
    expect(fileSystem.exists("package.json")).toBe(true);
    expect(fileSystem.exists("package.json")).toBe(true);
  });
});
