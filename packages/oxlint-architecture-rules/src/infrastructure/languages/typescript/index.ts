import type { Language } from "../../../ports/language.js";
import { makeFactExtractorLive } from "../../fact-extractor-live.js";
import { makeModuleResolverLive } from "../../module-resolver-live.js";

// TypeScript, as one language pack: the parser-backed extractor and the
// `unrs-resolver`-backed resolver, behind the `Language` port. This is the one
// place in the package that knows both halves belong to the same language —
// and, once the hosts construct it, the only place a second pack has to mirror.
export const typescriptLanguage = (): Language => ({
  id: "typescript",
  extensions: [".ts", ".tsx", ".mts", ".cts"],
  // A declaration file states types, not code; no linter visits one and no
  // policy is written about one.
  ignoredFiles: [/\.d\.[cm]?ts$/],
  extractor: makeFactExtractorLive(),
  makeResolver: (repoRoot, scope) => makeModuleResolverLive(repoRoot, { scopes: [scope] }),
});
