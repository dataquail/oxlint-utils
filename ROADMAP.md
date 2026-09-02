# oxlint-architecture-rules — roadmap

A sequenced plan for taking the package from "path and import policy with two half-blind
symbol families" to a single policy surface for a TypeScript repository. Ordered by
value-per-effort, and so that each phase makes the next one safe to build.

The through-line: **the package's central promise is that a configured rule cannot silently
enforce nothing.** Today that promise is kept at the pattern layer (probes) and broken at the
fact-extraction layer (what the adapters read out of a syntax tree). Phase 0 closes that hole;
everything after it adds facts and rule families on top of a foundation that can no longer
drift silently.

---

## Findings this plan responds to

Verified against `src/` on 2026-09-02, by reading both adapters and running the CLI extractor
over a fixture.

| #   | Finding                                                                                                                                                                                                                                                                                                   | Where                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| F1  | `type-members` sees only `type X = { … }` — a type alias whose RHS is exactly one bare type literal. `interface`, class bodies, and `type X = Base & { … }` are invisible. An intersection reports the `Base` half under the wrong declaration name and drops the literal half.                           | `adapters/cli/source-facts.ts:120`, `adapters/oxlint/members-rule.ts:113`    |
| F2  | Probes never touch a parser. Every `*RulesFailingTheirProbe` builds a synthetic site/edge/path from the probe's strings and runs it through the core. A rule can pass its probe while the adapter would never hand it a matching fact.                                                                    | `core/members.ts`, `core/exports.ts`, `core/imports.ts`, `core/structure.ts` |
| F3  | The two adapters disagree on what an import edge is. The CLI records `import("…")`, `require("…")` and `import x = require("…")`; the oxlint rule visits only `ImportDeclaration` / `ExportNamedDeclaration` / `ExportAllDeclaration`. A dynamic import fails `lint:architecture` and passes `pnpm lint`. | `adapters/oxlint/imports-rule.ts:57`, `adapters/cli/source-facts.ts:108`     |
| F4  | No rule reads a file's own exports. `exports-rule` returns early without a `source`, so `export const`, `export default` and every local declaration are outside every family. Naming conventions are enforced on filenames only.                                                                         | `adapters/oxlint/exports-rule.ts:86`                                         |
| F5  | `export * from "./x"` launders every symbol past the `exports` family (both adapters record the edge with zero bindings). `import * as ns` yields the symbol `*`, so `ns.forbidden()` is unpoliced.                                                                                                       | `exports-rule.ts`, `source-facts.ts:60`                                      |
| F6  | Default imports are representable (`BindingKind` has `default`) but `DEFAULT_KINDS = ["named"]` and the manifest's `ExportRestriction` exposes no `kinds` — the manifest cannot reach the machinery the core has.                                                                                         | `core/exports.ts:16`, `manifest/manifest.ts:96`                              |
| F7  | The repository's own `architecture.config.mjs` carries no `members` and no `exports` rule. Two of four families are not dogfooded, which is why F1/F4/F5 went unnoticed.                                                                                                                                  | `architecture.config.mjs`                                                    |
| F8  | No graph properties: no cycle detection, no transitive reach, no orphan detection. Every rule is one edge or one file at a time, and a barrel hop defeats a layering rule.                                                                                                                                | (absent)                                                                     |

Import aliasing is **not** a finding: `ImportSpecifier` reads `imported`, the CLI reads
`propertyName ?? name`, re-exports read the source-module name. This is correct and stays.

---

## Phase 0 — Make extraction gaps impossible to miss

Nothing else in this plan is trustworthy until this lands. Three pieces, one PR each, stackable.

### 0.1 `architecture facts <file>` — show what the extractor sees

A CLI subcommand beside `explain` that prints a file's `SourceFacts`: every specifier, the
bindings on it, every member site with its declaration name. `explain` answers "which rules
select this file"; `facts` answers "what would those rules be evaluated against". Together
they let a config author verify a rule by looking rather than by planting a violation.

- `adapters/cli/run.ts`: add the command; JSON output with `--json`, aligned text otherwise.
- Docs: `enforcement/cli.mdx`.
- Cheapest item on the list, and it makes every later extraction change reviewable.

### 0.2 Adapter parity test — one fixture corpus, two adapters, identical facts

The design claim is that both adapters "meet at the same vocabulary". Test it. A corpus of
source fixtures (`src/adapters/fixtures/*.ts`) covering every syntactic form the package
claims to see — static/dynamic/require/import-equals edges, each binding form, each declaration
shape — and a test that extracts facts through **both** adapters and asserts the results are
equal. Any future divergence (F3 is the existing one) fails here, not in a user's CI.

- Needs a small harness to run the oxlint rule over a snippet and collect the sites it
  reports; `RuleTester` already exists for this, or a fact-collecting shim rule can be built
  from the same visitor functions once they are factored out of `makeMembersRule` /
  `makeExportsRule`.
- **Fix F3 in the same PR**: register `ImportExpression` and a `require` / `import =`
  `CallExpression` branch in `imports-rule.ts`. The parity test is what proves it.

### 0.3 Fixture probes — a probe that goes through the parser

Extend every probe with an optional `source` form. Today:

```js
probe: { from: "src/ports/x.ts", name: "readFile", in: "FileSystem" }
```

Additionally allowed:

```js
probe: {
  from: "src/ports/x.ts",
  source: `export type FileSystem = Base & { readFile(p: string): string }`,
  name: "readFile", in: "FileSystem",
}
```

When `source` is present, the load-time probe check parses it with the adapter that is loading
(TypeScript for the CLI, the oxlint visitor for the plugin), extracts facts, and requires the
rule to fire on the named site. The synthetic form stays as the default so no existing config
changes; the fixture form is what an author reaches for when the rule is about a declaration
shape. Same for `exports` probes (a `source` import statement) and `imports` probes.

- `domain/architecture-config.ts`: widen the `*Probe` schemas.
- `manifest/compile.ts`: pass `source` through lowering.
- Probe evaluation moves from pure-core to "core, given facts" — the adapters supply an
  `extractFacts(source)` function through a small port so `core/` still reads no files.
- Docs: `enforcement/probes.mdx` gets a section on when to use which form.

**As landed:** `members` and `exports` only, with `name`/`symbol` required so the check is
"this source, this name, must be reported". No `imports` form — what it would prove (a
syntax is an edge) is pinned for every rule by the parity suite. The extractor at load is
the TypeScript one (`infrastructure/fact-extractor-live.ts`, behind a `FactExtractor` port)
for both adapters; there is no oxc parser in the tree, and parity is what holds oxlint's
visitor to it. `config-loader.test.ts` carries the demonstration: the same rule probed with a
bare alias loads and probed with an `interface` is refused.

---

## Phase 1 — Fix the families that exist

### 1.1 Widen `type-members` (F1)

Extract members from every declaration shape a port realistically takes:

- `interface X { … }` — same `TSPropertySignature` / `TSMethodSignature` members, declaration
  name from `id`. Own members only; `extends` targets are their own declarations.
- `type X = A & { … }` / `type X = { … } | { … }` — flatten intersection and union
  constituents; literal members are reported under `X`, not under a constituent's name.
- `type X = SomeAlias` referencing a same-file alias — follow one level so
  `type Port = PortShape` still reports members under `Port`. Cross-file references are
  out of scope (would need the checker).
- `class` bodies — **separate subject**, `class-members`, in a follow-up; a class is a
  runtime object with visibility modifiers and is not the same vocabulary question.

Both adapters, plus fixtures in the 0.2 corpus for each shape. Keep the literal
`"type-members"`; document it as "members of a named type declaration".

**As landed:** interfaces (own members; `extends` not followed), and inside an alias,
intersections, unions and parentheses — all reported under the declaring name. **No
reference following at all**, including the same-file alias case above: `Base`'s members
are reported under `Base` where they are written, and following a reference would report
every member twice under two names. The demonstration in `config-loader.test.ts` now
refuses a `class` probe, since an `interface` one loads.

### 1.2 Expose `kinds` in the manifest and close `export *` (F5, F6)

- `ExportRestriction` gains `kinds?: Array<"named" | "default" | "namespace">`, lowered to
  the existing `ExportRule.kinds`. Documented default stays `["named"]` with a loud note that
  a rule about a factory function almost always wants `["named", "default"]`.
- `export * from "m"` is recorded as one binding `{ symbol: "*", kind: "namespace" }` in both
  adapters, so a rule with `kinds: ["namespace"]` can forbid the laundering form and a
  `symbols`-less rule sees it.
- Namespace member access (`ns.forbidden()`) is left as a documented limitation; closing it
  needs binding-aware tracking within a file and is listed under Phase 4.

**As landed:** every whole-module form carries the `*` namespace binding, not only `export *`
— `export * as ns`, `import x = require()`, `import()` and `require()` too, since each takes
the module at once exactly as `import * as` does and `const { x } = await import("m")` is the
same laundering vector. The synthetic probe for a restriction is a binding of its first kind
(`default` / `*` by name), so `symbols` alongside a default or namespace kind is refused at
load as the contradiction it is. The autofix is offered on `import` declarations only.

### 1.3 Dogfood `members` and `exports` in this repo (F7)

Add at least one real rule of each family to the root `architecture.config.mjs`:

- `members`: `src/ports/**` type members must be `camelCase` and match a verb-ish allowlist
  (`resolve`, `readFile`, …) — or, more usefully, `calls` in `src/core/**` may not include
  `readFileSync` / `existsSync` / `require`, which is the "core never reads a file" rule
  stated in code rather than prose.
- `exports`: `adapters/oxlint/**` may not name-import `ts` from `typescript`, or the CLI
  adapter may not import `oxlint/plugins-dev` — whichever a path rule cannot already say.

The point is not the rules; it is that `pnpm lint` now exercises all four families on every
commit. Do this **after** 1.1 and 1.2 so the rules can be written against the widened surface.

**As landed:** four rules, each with an authored probe, each verified to fire under both
`oxlint` and `architecture check` by planting its violation. `members`: `core/` and
`domain/` may not call `*Sync` / `readFile` / `readdir` / `writeFile` / `require`; a `ports/`
type member starts lowercase. `exports`: `make*Live` is imported only by `config-loader.ts`,
the barrel and tests; no `namespace` binding of any `@arch/**` module. Writing the first
`members` rule on a folder node found a lowering bug — `members` selected the folder's own
path rather than its subtree (as `imports` does), so a folder-level vocabulary governed no
file and its folder-path probe passed anyway. Fixed and pinned in `compile.test.ts`.

---

## Phase 2 — A fifth family: the export surface

The missing half of `exports` (F4). `exports` says which importers may _name_ a symbol; this
says what a file may _offer_. No module resolution needed, so it is as cheap as `members`.

Manifest node key: `surface` (not `exports`, which is taken at the top level).

```js
"*.handler.ts": {
  surface: {
    message: "A handler exports exactly one function, named after its file.",
    default: "forbid",             // "forbid" | "require" | "allow" (default allow)
    only: [{ like: "{base}", convention: "camelCase" }],   // every export must match one
    count: 1,                       // optional exact count
  },
},
"index.ts": {
  surface: { message: "A barrel re-exports; it declares nothing.", reexportOnly: true },
},
```

Facts: for each file, the list of `{ name, kind: "named" | "default", form: "declaration" |
"reexport", declarationKind: "function" | "const" | "class" | "type" | … }`. Both adapters
already visit `ExportNamedDeclaration`; add `ExportDefaultDeclaration` and read the declaration
child. Core evaluator in `core/surface.ts`; violation kind `"surface"`; probe is a fixture
probe from 0.3 (a synthetic probe cannot describe a declaration).

This is where "naming conventions of exported variables" actually lands — `structure.naming`
keeps governing filenames, and `surface.only` reuses the same `Naming` vocabulary for
identifiers, including `like: "{base}"` for named-after-the-file.

---

## Phase 3 — Graph rules (CLI-only, by design)

F8. This is the capability that most separates an architecture tool from a lint rule, and it
cannot live in the oxlint adapter: the plugin sees one file at a time with no cross-file state.
Make that an explicit, documented asymmetry — `lint:architecture` becomes a superset of the
plugin rather than a mirror — and say so in `enforcement/cli.mdx`.

Manifest: a top-level `graph` section.

```js
graph: {
  cycles: { message: "…", within: "packages/*/src/**", except: [...] },
  orphans: { message: "…", within: "src/**", entry: ["src/index.ts", "src/adapters/**/main.ts"] },
  reach: [{
    message: "adapters reach infrastructure only through ports",
    from: "@arch/adapters/**", to: "@arch/infrastructure/**", via: "@arch/ports/**",
  }],
},
```

Work:

- `collectFindings` currently skips files no rule selects and resolves only selected edges. A
  graph pass resolves **every** edge of every source file once, into an adjacency map, before
  rule evaluation. `unrs-resolver` makes this cheap; cache by `(importer, specifier)`.
- `core/graph.ts`: Tarjan SCC for cycles (report each cycle once, fingerprint by sorted member
  set so the baseline is stable); reverse-reachability from `entry` for orphans; BFS with a
  `via` cut-set for `reach` (a violation is a path that reaches `to` without passing through
  `via`).
- Violation kind `"graph"`, subject is the cycle/path rendered as `a → b → c`, so the baseline
  ratchet works unchanged.
- Probes: synthetic graphs (a two-node cycle, an unreachable node) — the pattern layer is all
  a graph probe has to prove; the facts are the resolver's, already covered by `resolution`.
- Baseline: existing cycles land in the baseline on first run, and the ratchet does what it
  does.

---

## Phase 4 — Beyond `.ts`: the workspace as a policy subject

What makes it a one-stop shop. The core does not care where a fact came from.

- **`package.json` policy.** Per-package `dependencies` allowlist expressed in the same tree —
  a layer graph stated in workspace deps, not only in imports. `exports` map must point at
  files that exist in `files`. Pinning rules (`effect` exact) as policy rather than a
  CLAUDE.md warning. Facts from a JSON reader; rules are `imports`-shaped with
  `dependencyKind: "external"` already half there.
- **`tsconfig` policy.** Required strictness flags per package; `references` must agree with
  the import graph from Phase 3 (a package that imports another it does not reference is a
  build-order bug waiting to happen).
- **Type references per layer.** A `members` subject `type-refs`: identifiers used in type
  position. "`domain/` may not mention `Effect`", "`core/` may not reference `ts.Node`".
  Same machinery as `calls`, different visitor. (Explicit return types, `any`, `as` — leave
  to `@effect/tsgo` / typescript rules already in the config; do not duplicate.)
- **Receiver-aware `calls`.** Record the receiver of a member call when it is an imported
  binding, closing the `import * as ns; ns.forbidden()` gap from 1.2.

---

## Phase 5 — Ratchets and coverage

The baseline is a ratchet on violations. Add ratchets on _policy_:

- **`unrestricted` ceiling.** A top-level `limits: { unrestricted: N }` that fails when more
  nodes carry `unrestricted: true` than allowed, so the adoption backlog cannot grow.
- **Policy coverage report.** `architecture coverage`: what fraction of source files is
  governed by a node that is neither `partial` nor `unrestricted`, per family. Probes prove a
  rule _can_ fire; coverage proves the tree is actually _reached_. Optionally a ratchet:
  coverage may not decrease.

---

## Deliberately not planned

- **Decorators, JSDoc tags (`@internal`), `satisfies`** as policy inputs. Real, but each is a
  convention specific to one framework or team; revisit if a concrete rule is wanted.
- **Cross-file type resolution** (following an alias into another module, checker-backed
  facts). Would pull the TypeScript checker into the CLI and is unavailable to the plugin.
  Everything above is achievable syntactically.
- **Renaming `type-members`.** The literal stays; widening its meaning is cheaper than a
  migration for a package still in beta.

---

## Sequencing and shape of the work

Each phase is one `gh stack`; each numbered item is one layer. Every layer carries: both
adapters, core tests, a fixture in the parity corpus, the relevant `website/…/architecture-rules`
page, and — where the family has one — a rule in the root `architecture.config.mjs`.

```
Phase 0  facts cmd → parity test (+F3 fix) → fixture probes   [done]
Phase 1  widen type-members [done] → kinds + export * [done] → dogfood members/exports [done]
Phase 2  surface family
Phase 3  graph pass → cycles → orphans → reach
Phase 4  package.json → tsconfig → type-refs → receiver-aware calls
Phase 5  unrestricted ceiling → coverage
```

Phases 0 and 1 are the ones that protect the package's existing promise and should ship before
the next beta. Phases 2 and 3 are the ones that change what the package is. 4 and 5 are
polish that only matters once 2 and 3 exist.
