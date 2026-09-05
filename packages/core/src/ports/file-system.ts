// Sibling-parity rules ask a question no AST can answer: does this other file
// exist? And the loader reads the baseline the manifest names. A port keeps both
// testable without a fixture tree on disk.
export type FileSystem = {
  readonly exists: (repoRelativePath: string) => boolean;
  // The file's text, or `null` when it is absent or unreadable.
  readonly readText: (repoRelativePath: string) => string | null;
};
