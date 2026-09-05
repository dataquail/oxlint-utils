import * as path from "node:path";

import * as Result from "effect/Result";

import { makeFileSystemLive } from "../../infrastructure/file-system-live.js";
import { typescriptLanguage } from "../../infrastructure/languages/typescript/index.js";
import { DEFAULT_CONFIG_FILENAME, readManifestFile } from "../../infrastructure/manifest-file.js";
import { type LoadedPolicy, loadPolicy } from "../../load/policy.js";

export type { LoadedPolicy } from "../../load/policy.js";

// The CLI's composition root: read the manifest file, construct the language
// packs and the live file system, and hand them to the loader. The plugin has
// one of its own with the same three lines, on purpose — the two hosts share
// the core and never each other.
export const loadPolicyFromFile = async (
  repoRoot: string,
  configFilename: string = DEFAULT_CONFIG_FILENAME,
): Promise<LoadedPolicy> => {
  const configPath = path.resolve(repoRoot, configFilename);
  const loaded = loadPolicy({
    repoRoot,
    configPath,
    manifest: await readManifestFile(configPath),
    languages: [typescriptLanguage()],
    fileSystem: makeFileSystemLive(repoRoot),
  });
  if (Result.isFailure(loaded)) throw loaded.failure;
  return loaded.success;
};
