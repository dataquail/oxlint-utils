import * as Result from "effect/Result";

import { ImportUnresolved } from "../domain/architecture-error.js";
import type { ModuleResolver, ResolvedTarget } from "../ports/module-resolver.js";
import { npmPackageOf } from "./npm-package.js";

// Keyed by specifier alone: a core-evaluator test states the edges it is about
// and never the resolution algorithm, which has its own tests against the real
// resolver.
//
// A target may be staged as the full `ResolvedTarget`, or as a path alone — in
// which case its kind and package are read the way the TypeScript resolver
// would report them, so a test written in that language's vocabulary stays
// short. A test about another language stages the whole target.
export const makeModuleResolverFake = (
  targets: Readonly<Record<string, string | ResolvedTarget>>,
): ModuleResolver => ({
  resolve: (fromFile, specifier) => {
    const staged = targets[specifier];
    if (staged === undefined) {
      return Result.fail(
        new ImportUnresolved({ fromFile, specifier, detail: "not staged in the fake" }),
      );
    }
    return Result.succeed(typeof staged === "string" ? targetOfPath(staged) : staged);
  },
});

const targetOfPath = (path: string): ResolvedTarget => {
  if (path.startsWith("node:")) return { path, kind: "builtin" };
  const pkg = npmPackageOf(path);
  return pkg === undefined ? { path, kind: "local" } : { path, kind: "external", package: pkg };
};
