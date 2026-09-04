import { pathToFileURL } from "node:url";

import { ConfigInvalid } from "../domain/architecture-error.js";

export const DEFAULT_CONFIG_FILENAME = "architecture.config.mjs";

// The manifest, as the file on disk states it, before any decoding. Today that
// is a JavaScript module and its default export; a manifest in another format
// changes this function and nothing behind it.
export const readManifestFile = async (configPath: string): Promise<unknown> => {
  const module: unknown = await import(pathToFileURL(configPath).href).catch((cause: unknown) => {
    throw new ConfigInvalid({ configPath, detail: String(cause) });
  });
  return typeof module === "object" && module !== null && "default" in module
    ? module.default
    : module;
};
