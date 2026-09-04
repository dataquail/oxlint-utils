import type * as Result from "effect/Result";

import type { ResolveScope } from "../domain/architecture-config.js";
import type { ScopeInvalid } from "../domain/architecture-error.js";
import type { FactExtractor } from "./fact-extractor.js";
import type { ModuleResolver } from "./module-resolver.js";

// Everything the policy needs from one programming language, behind one port.
//
// The manifest vocabulary — a file, an import edge, a resolved target, a
// declared member — is not TypeScript's. What is TypeScript's is how a
// specifier becomes a file, which extensions a source file carries, and how the
// facts are read out of one. A language pack answers those three questions; the
// core and the manifest ask nothing else of it, and can be tested with a pack
// that answers from a table.
export type Language = {
  // The name a `resolve.scopes` entry selects the pack by.
  readonly id: string;
  // The extensions of a source file the walker should visit, with the dot.
  readonly extensions: ReadonlyArray<string>;
  // Files carrying one of those extensions that are not source — for
  // TypeScript, a declaration file states types and no linter visits one.
  readonly ignoredFiles: ReadonlyArray<RegExp>;
  // Reads the facts out of one source text. The CLI reads every file through
  // it, and a probe carrying a `source` snippet is parsed by it at load.
  readonly extractor: FactExtractor;
  // A resolver for the files one scope covers. Built once per scope per run;
  // resolution is the expensive half of linting an architecture. The scope's
  // `options` are this language's to read, and anything it does not
  // understand is refused here, at load — never resolved on defaults.
  readonly makeResolver: (
    repoRoot: string,
    scope: ResolveScope,
  ) => Result.Result<ModuleResolver, ScopeInvalid>;
};
