import { readdirSync, statSync } from "node:fs";
import * as path from "node:path";

import type { Language } from "../ports/language.js";

// Folders no policy is written about and no linter visits. These are the right
// defaults for any language on this host: a package store, build output, the
// VCS, and a coverage report are never the architecture.
const SKIPPED = new Set([
  "node_modules",
  "build",
  "dist",
  ".next",
  ".git",
  "storybook-static",
  "coverage",
]);

// What the walker needs to know about a language: what a source file of it is
// called, and which of those are not source after all.
export type WalkedLanguage = Pick<Language, "extensions" | "ignoredFiles">;

// The source files under `roots`, repo-relative with forward slashes, sorted.
// Which files count as source is the languages' to say: the extension set is
// the union of theirs, and so is the set of files to step over. A root that
// names a file is that file, whatever its extension — `architecture check
// <file>` is a reasonable thing to type.
export const listSourceFiles = (
  repoRoot: string,
  roots: ReadonlyArray<string>,
  languages: ReadonlyArray<WalkedLanguage>,
): ReadonlyArray<string> => {
  const extensions = new Set(languages.flatMap((language) => language.extensions));
  const ignored = languages.flatMap((language) => language.ignoredFiles);
  const isSource = (entry: string): boolean =>
    extensions.has(path.extname(entry)) && !ignored.some((pattern) => pattern.test(entry));

  const found: Array<string> = [];
  const walk = (absolute: string): void => {
    for (const entry of readdirSync(absolute)) {
      if (SKIPPED.has(entry)) continue;
      const child = path.join(absolute, entry);
      if (statSync(child).isDirectory()) walk(child);
      else if (isSource(entry))
        found.push(path.relative(repoRoot, child).replaceAll(path.sep, "/"));
    }
  };
  for (const root of roots) {
    const absolute = path.resolve(repoRoot, root);
    if (statSync(absolute).isDirectory()) walk(absolute);
    else found.push(path.relative(repoRoot, absolute).replaceAll(path.sep, "/"));
  }
  return found.sort();
};
