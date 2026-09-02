import type { BindingKind, MemberSubject } from "./architecture-config.js";

// What a policy can know about one source file, read once. Both adapters
// produce this vocabulary — the plugin from oxlint's syntax tree, the CLI from
// TypeScript's — which is what keeps them answerable to the same core rather
// than to each other. A rule is evaluated against these and nothing else.

// One name pulled across one import edge: `import { makeCommandBus } from "…"`
// is a single binding, and so is the `Effect` in `import { Effect } from "effect"`.
export type Binding = {
  readonly symbol: string;
  readonly kind: BindingKind;
};

// One declared or called name, and the declaration it sits in (a type alias's
// name for `type-members`, absent for `calls`).
export type MemberSite = {
  readonly file: string;
  readonly subject: MemberSubject;
  readonly name: string;
  readonly in?: string;
};

export type SourceFacts = {
  // One entry per import edge, in source order. An edge appears once even if it
  // carries several bindings.
  readonly specifiers: ReadonlyArray<string>;
  // The names pulled across each edge, keyed by specifier.
  readonly bindings: ReadonlyMap<string, ReadonlyArray<Binding>>;
  readonly memberSites: ReadonlyArray<MemberSite>;
};
