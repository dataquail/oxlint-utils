import * as path from "node:path";

import {
  DEFAULT_CONFIG_FILENAME,
  type LoadedPolicy,
  loadPolicy,
  makeFileSystemLive,
  readManifestFile,
} from "@goodbones/core";
import { typescriptLanguage } from "@goodbones/typescript";
import * as Result from "effect/Result";

export type { LoadedPolicy } from "@goodbones/core";
export { DEFAULT_CONFIG_FILENAME } from "@goodbones/core";

// The plugin's composition root: read the manifest file, construct the
// language packs and the live file system, and hand them to the loader. A load
// failure throws out of here and out of oxlint's import of the plugin — a
// plugin that came up with no policy would report nothing and be
// indistinguishable from a clean codebase.
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
