import type * as Result from "effect/Result";

import type { ImportUnresolved } from "../domain/architecture-error.js";

export type DependencyKind = "local" | "external" | "builtin";

export type ResolvedTarget = {
  // Repo-relative with forward slashes for a file on disk (including one under
  // a package store such as `node_modules/`), or the runtime's own name for a
  // builtin (`node:fs`). This is the exact vocabulary dependency-cruiser reports
  // in, so ported `to` patterns — including `/node_modules/effect/` against a
  // pnpm `.pnpm/…` path — match unchanged.
  readonly path: string;
  // `builtin` is its own kind rather than a flavour of external, because a rule
  // that fences off third-party dependencies is not talking about `node:crypto`.
  readonly kind: DependencyKind;
  // For an `external`, the package the target belongs to, as an `imports.external`
  // entry names it (`effect`, `@scope/name`). The resolver knows where its language
  // keeps packages; the policy only knows their names.
  readonly package?: string;
};

export type ModuleResolver = {
  readonly resolve: (
    fromFile: string,
    specifier: string,
  ) => Result.Result<ResolvedTarget, ImportUnresolved>;
};
