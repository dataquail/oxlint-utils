import * as path from "node:path";

import {
  findManifestFile,
  type LoadedPolicy,
  loadPolicy,
  makeFileSystemLive,
  readManifestFile,
} from "@goodbones/core";
import { typescriptLanguage } from "@goodbones/typescript";
import * as Result from "effect/Result";

export type { LoadedPolicy } from "@goodbones/core";

// The CLI's composition root: read the manifest file, construct the language
// packs and the live file system, and hand them to the loader. The plugin has
// one of its own with the same three lines, on purpose — the two hosts share
// the core and never each other.
export const loadPolicyFromFile = async (
  repoRoot: string,
  configFilename?: string,
): Promise<LoadedPolicy> => {
  // Named, or discovered: architecture.yaml, .yml, .json, or .config.mjs,
  // exactly one of which may be present.
  const configPath =
    configFilename === undefined
      ? findManifestFile(repoRoot)
      : path.resolve(repoRoot, configFilename);
  const read = await readManifestFile(configPath);
  const loaded = loadPolicy({
    repoRoot,
    configPath,
    manifest: read.manifest,
    locate: read.locate,
    languages: [typescriptLanguage()],
    fileSystem: makeFileSystemLive(repoRoot),
  });
  if (Result.isFailure(loaded)) throw loaded.failure;
  return loaded.success;
};
