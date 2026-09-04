import type { SourceFacts } from "../domain/facts.js";

// Reads the facts out of one source text. `file` is the repo-relative path the
// facts are attributed to; it also decides the grammar (`.tsx` or not).
//
// The CLI reads every file through this. The plugin reads through oxlint's own
// visitor instead — but a probe that carries a source snippet is checked
// through this port at load time, whichever adapter is loading, so "the rule
// fires on this declaration" is a fact about a parser and not about a pattern.
export type FactExtractor = {
  readonly factsOf: (file: string, text: string) => SourceFacts;
};
