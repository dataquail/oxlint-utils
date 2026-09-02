import * as Schema from "effect/Schema";

// Every pattern in this config is a JavaScript regular-expression source string
// matched against a repo-relative, forward-slash path — the same vocabulary
// dependency-cruiser rules are written in, so a rule ported from there keeps its
// pattern character-for-character. A list matches when ANY member matches.
const PatternList = Schema.Union([Schema.String, Schema.Array(Schema.String)]);

// An import edge is a violation when the importer matches `from` (and not
// `fromNot`) AND the resolved target matches `to` (and not `toNot`). Omitting
// `to` means "any target", which is how a rule expresses "this folder may not
// import anything outside its allowlist" as a single `toNot`.
// A synthetic edge this rule must report. Every rule carries one: a configured
// rule that reports nothing is indistinguishable from a clean codebase, and that
// is the failure this package exists to make impossible. `from` is a repo-relative
// importer path, `to` a repo-relative RESOLVED target (a `node_modules/...` path
// for an external, `node:<name>` for a builtin).
const ImportProbe = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
});

export const ImportRule = Schema.Struct({
  name: Schema.String,
  message: Schema.String,
  probe: ImportProbe,
  from: PatternList,
  fromNot: Schema.optionalKey(PatternList),
  to: Schema.optionalKey(PatternList),
  toNot: Schema.optionalKey(PatternList),
  // `external` is a target inside node_modules, `builtin` a node: module,
  // `local` anything else. Replaces dependency-cruiser's `dependencyTypes`,
  // whose finer npm grades no rule in this repo distinguishes.
  dependencyKind: Schema.optionalKey(Schema.Literals(["external", "local", "builtin"])),
});

// Resolution is tsconfig-driven, and this monorepo needs two: the web/components
// pass resolves `@/*` and `@org/components/*` that the server pass does not.
const ResolveScope = Schema.Struct({
  files: Schema.String,
  tsconfig: Schema.String,
});

export const ResolveConfig = Schema.Struct({
  scopes: Schema.Array(ResolveScope),
  extensions: Schema.optionalKey(Schema.Array(Schema.String)),
  conditionNames: Schema.optionalKey(Schema.Array(Schema.String)),
  mainFields: Schema.optionalKey(Schema.Array(Schema.String)),
  // An edge nobody can resolve is an edge no rule can police, which is the
  // silent-vacuity failure this whole package exists to prevent. Default loud.
  unresolved: Schema.optionalKey(Schema.Literals(["error", "off"])),
  ignoreUnresolved: Schema.optionalKey(Schema.Array(Schema.String)),
});

// Which binding form an import site used. A rule that fences off a factory
// function cares about `named`; one steering people to namespace subpath imports
// cares that `named` was used at all.
const BindingKind = Schema.Literals(["named", "default", "namespace"]);

// `source`, when present, is a snippet the loading adapter parses: the probe
// then holds only if a binding named `symbol` comes out of the parser and the
// rule covers it, with every edge in the snippet taken to resolve to `to`.
// Without it the probe is a synthetic binding of `symbol` and `kind`.
const ExportProbe = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  symbol: Schema.String,
  kind: Schema.optionalKey(BindingKind),
  source: Schema.optionalKey(Schema.String),
});

// Where a given *exported symbol* may be imported. `imports` asks whether one
// file may reach another at all; this asks which names it may pull across when
// it does — the distinction a path rule cannot make, because every importer of a
// barrel resolves to the same file.
export const ExportRule = Schema.Struct({
  name: Schema.String,
  message: Schema.String,
  probe: ExportProbe,
  from: PatternList,
  fromNot: Schema.optionalKey(PatternList),
  to: PatternList,
  toNot: Schema.optionalKey(PatternList),
  // Exact exported names. Omit to mean "any name", which is how a rule bans a
  // whole binding form (every named import from a package barrel, say).
  symbols: Schema.optionalKey(Schema.Array(Schema.String)),
  // Defaults to ["named"] — the discriminating form for every rule of this shape
  // written so far.
  kinds: Schema.optionalKey(Schema.Array(BindingKind)),
  // A named autofix strategy. `subpath-namespace-import` rewrites
  // `import { A, B as C } from "pkg"` into `import * as A from "pkg/A"` /
  // `import * as C from "pkg/B"`, for packages that publish each module as its own
  // subpath. A rule carrying a fix reports once per declaration rather than once
  // per symbol, because the fix rewrites the whole declaration.
  fix: Schema.optionalKey(Schema.Literals(["subpath-namespace-import"])),
});

// What kind of declared name a rule is about. `type-members` are the members
// written in a named type declaration — an alias or an interface, through
// intersections and unions — (a port's method vocabulary); `calls` are called
// identifiers (the hooks a tier may reach for).
const MemberSubject = Schema.Literals(["type-members", "calls"]);

// `source`, when present, is a snippet the loading adapter parses: the probe
// then holds only if a site named `name` comes out of the parser and the rule
// reports it — the declaration shape is the parser's to judge, not `in`'s.
// Without it the probe is a synthetic site of `name` inside `in`.
const MemberProbe = Schema.Struct({
  from: Schema.String,
  name: Schema.String,
  in: Schema.optionalKey(Schema.String),
  source: Schema.optionalKey(Schema.String),
});

// Which names a file is allowed to declare or call. This is the one family that
// needs no module resolution: it is about the vocabulary inside a file, not the
// edges leaving it.
export const MemberRule = Schema.Struct({
  name: Schema.String,
  message: Schema.String,
  probe: MemberProbe,
  from: PatternList,
  fromNot: Schema.optionalKey(PatternList),
  subject: MemberSubject,
  // `type-members` only: which declaration's members are governed.
  in: Schema.optionalKey(PatternList),
  // Which names the rule speaks to at all. Omit for "every one".
  match: Schema.optionalKey(PatternList),
  matchNot: Schema.optionalKey(PatternList),
  // Names that are fine. A name the rule speaks to and this does not admit is
  // the violation.
  allow: Schema.optionalKey(PatternList),
});

// What an exported name was declared as, when it was declared in the file.
// `expression` is `export default <expr>`; `other` covers a namespace, an
// `export =`, and a re-export, whose declaration is somewhere else.
export const DeclarationKind = Schema.Literals([
  "function",
  "class",
  "variable",
  "type",
  "interface",
  "enum",
  "expression",
  "other",
]);

// One export site, as a probe states it: the name (`default` for a default
// export, `*` for `export *`), its binding kind, and optionally what it was
// declared as and whether it is a re-export.
const SurfaceSite = Schema.Struct({
  name: Schema.String,
  kind: BindingKind,
  declares: Schema.optionalKey(DeclarationKind),
  reexport: Schema.optionalKey(Schema.Boolean),
});

// A whole surface, because `count` is about the file rather than a site.
// `source`, when present, is parsed by the loading adapter instead.
const SurfaceProbe = Schema.Struct({
  from: Schema.String,
  sites: Schema.optionalKey(Schema.Array(SurfaceSite)),
  source: Schema.optionalKey(Schema.String),
});

// What a file may export. The selectors (`kinds`, `declares`, `reexport`,
// `match`) say which sites the rule speaks to; exactly one demand says what is
// required of them. No demand means `forbid`: a selected site is the violation.
export const SurfaceRule = Schema.Struct({
  name: Schema.String,
  message: Schema.String,
  probe: SurfaceProbe,
  from: PatternList,
  fromNot: Schema.optionalKey(PatternList),
  kinds: Schema.optionalKey(Schema.Array(BindingKind)),
  declares: Schema.optionalKey(Schema.Array(DeclarationKind)),
  reexport: Schema.optionalKey(Schema.Boolean),
  match: Schema.optionalKey(PatternList),
  matchNot: Schema.optionalKey(PatternList),
  forbid: Schema.optionalKey(Schema.Boolean),
  // Names that are fine; a selected site named otherwise is the violation.
  allow: Schema.optionalKey(PatternList),
  // A regular-expression source every selected name must match.
  convention: Schema.optionalKey(Schema.String),
  // How many selected sites the file may have.
  count: Schema.optionalKey(
    Schema.Struct({
      min: Schema.optionalKey(Schema.Finite),
      max: Schema.optionalKey(Schema.Finite),
    }),
  ),
});

const PathProbe = Schema.Struct({ path: Schema.String });

// The file taxonomy, as three questions rather than one nested tree.
//
// `roots` marks the regions where layout is deny-by-default. `folders` says
// which basenames each folder admits. `parity` says which siblings a file owes.
// Keeping them apart is what removes the nested config's most fragile rule —
// that a specific pattern must beat a `*` catch-all — because an exemption is
// now a `fileNot` on the parity rule that would otherwise fire.
const StructureRoot = Schema.Struct({
  name: Schema.String,
  message: Schema.String,
  probe: PathProbe,
  // A file under this path whose folder no `folders` rule governs is a file in a
  // folder the taxonomy does not know about.
  path: PatternList,
});

const StructureFolder = Schema.Struct({
  name: Schema.String,
  message: Schema.String,
  probe: PathProbe,
  // Matched against the file's folder, repo-relative, with no trailing slash.
  folder: PatternList,
  // Basenames this folder admits. Anything else is the violation.
  files: PatternList,
});

const StructureParity = Schema.Struct({
  name: Schema.String,
  message: Schema.String,
  probe: PathProbe,
  file: PatternList,
  fileNot: Schema.optionalKey(PatternList),
  // Paths that must exist, relative to the file's own folder. `{base}` is the
  // filename minus its final extension, so `{base}.test.ts` beside
  // `create-todo.handler.ts` means `create-todo.handler.test.ts`.
  requires: Schema.Array(Schema.String),
});

// What shape the variable part of a name may take. `folders` says which
// stereotypes a folder admits; this says what the concept name in front of the
// stereotype may look like — the degree of freedom a taxonomy alone leaves open.
const StructureNaming = Schema.Struct({
  name: Schema.String,
  message: Schema.String,
  probe: PathProbe,
  // Matched against the whole repo-relative path, and carrying capture groups:
  // `subject` says which of them holds the name being judged.
  file: PatternList,
  fileNot: Schema.optionalKey(PatternList),
  subject: Schema.Finite,
  // The shape the subject must have. Exactly one of these.
  convention: Schema.optionalKey(Schema.String),
  // A capture group the subject must equal, for "named after its folder".
  sameAs: Schema.optionalKey(Schema.Finite),
});

const StructureConfig = Schema.Struct({
  roots: Schema.optionalKey(Schema.Array(StructureRoot)),
  folders: Schema.optionalKey(Schema.Array(StructureFolder)),
  parity: Schema.optionalKey(Schema.Array(StructureParity)),
  naming: Schema.optionalKey(Schema.Array(StructureNaming)),
});

export type ImportRule = (typeof ImportRule)["Type"];
export type ResolveConfig = (typeof ResolveConfig)["Type"];
export type ResolveScope = (typeof ResolveScope)["Type"];
export type ImportProbe = (typeof ImportProbe)["Type"];
export type ExportRule = (typeof ExportRule)["Type"];
export type ExportProbe = (typeof ExportProbe)["Type"];
export type BindingKind = (typeof BindingKind)["Type"];
export type MemberRule = (typeof MemberRule)["Type"];
export type MemberProbe = (typeof MemberProbe)["Type"];
export type MemberSubject = (typeof MemberSubject)["Type"];
export type DeclarationKind = (typeof DeclarationKind)["Type"];
export type SurfaceRule = (typeof SurfaceRule)["Type"];
export type SurfaceProbe = (typeof SurfaceProbe)["Type"];
export type StructureConfig = (typeof StructureConfig)["Type"];
export type StructureRoot = (typeof StructureRoot)["Type"];
export type StructureFolder = (typeof StructureFolder)["Type"];
export type StructureParity = (typeof StructureParity)["Type"];
export type StructureNaming = (typeof StructureNaming)["Type"];

export const patternsOf = (patterns: string | ReadonlyArray<string>): ReadonlyArray<string> =>
  typeof patterns === "string" ? [patterns] : patterns;
