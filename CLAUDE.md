# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An Nx + pnpm monorepo publishing oxlint plugins and tooling. Today that is one package:

- **`oxlint-architecture-rules`** (`packages/oxlint-architecture-rules`) — architecture policy written
  as one manifest of the repository (`architecture.config.mjs`), lowered into five oxlint rules
  (`imports`, `exports`, `members`, `surface`, `structure`) plus an `architecture` CLI that evaluates
  the same policy with no linter in the loop — and, being the one adapter that sees every file at
  once, the `graph` family (cycles, orphans, transitive reach) and the `limits` ratchets on the
  policy's own reach.

The package is unscoped on npm, and its directory name matches its published name. `website/` is an
Astro + Starlight docs site deployed to GitHub Pages at <https://dataquail.github.io/oxlint-utils>.

**The repository enforces its own architecture with the package it publishes.**
`architecture.config.mjs` at the root is a real policy over `packages/`, wired into `.oxlintrc.json` as
the `architecture` JS plugin, so `pnpm lint` fails on a layering violation. That makes the policy the
package's largest test: a change that breaks lowering or resolution breaks the lint run here first.
Every family is in it, deliberately — `imports` and `structure` for the layering, `members` for
"`core/` and `domain/` never touch the file system" and "a port member is camelCase", `exports` for
"a live adapter is constructed only at the composition root" and "no namespace import or `export *`
between tiers", `surface` for "no default exports, no `export *`", `graph` for no cycles, no dead
modules and "the pure tiers reach no adapter", and `limits` with both adoption ceilings at zero and
coverage floors at the numbers the day they were written — so a family whose extraction quietly
narrows breaks this lint run, not a user's.

## Commands

```bash
# Build (tsc -b -> build/esm + build/dts)
pnpm run build:packages
pnpm exec nx build oxlint-architecture-rules

# Test
pnpm run test:packages
pnpm exec nx test oxlint-architecture-rules

# Typecheck (tsc -b, src and tests)
pnpm run check:all
pnpm exec nx check oxlint-architecture-rules

# Lint — oxlint, type-aware. Warnings are tolerated; errors are not.
pnpm lint
pnpm run lint:fix

# Effect language-service diagnostics (separate from lint)
pnpm run check:effect

# The same policy through the CLI, with no linter in the loop
pnpm run lint:architecture
pnpm run architecture:explain packages/oxlint-architecture-rules/src/core/imports.ts
pnpm run architecture:facts packages/oxlint-architecture-rules/src/core/imports.ts   # what the parser read
pnpm run architecture:coverage                                                     # how much of the tree the policy reaches

# Everything, as the pre-commit hook runs it
pnpm run precommit

# Docs site
pnpm run dev:website
pnpm run build:website
```

## Things that will bite you

**The package's tsconfigs reset `paths` to `{}` on purpose.** oxlint loads the plugin's emitted
JavaScript with a bare dynamic `import()`, and tsc does not rewrite path aliases on emit — a `@/…`
specifier that typechecks would be a runtime `ERR_MODULE_NOT_FOUND`. Relative specifiers are what
actually run. `tsconfig.base.json` still declares a `paths` entry for the package so a _future_ sibling
package can import it by name.

**`build/esm/adapters/oxlint/plugin.js` is the plugin entrypoint**, exposed to consumers as the
`oxlint-architecture-rules/plugin` subpath export. `build/esm/adapters/cli/main.js` is the `architecture`
bin. Both are in the `exports`/`bin` maps, so renaming or moving those source files is a breaking change
even though nothing in `src/index.ts` mentions them.

**The build must run before the lint.** oxlint imports JavaScript, so a stale `build/` enforces a stale
policy while still linting green. Two things close that: the `lint` script builds first, and
`nx.json`'s `targetDefaults.lint` declares `dependsOn: ["build"]` so the Nx graph cannot order them the
other way.

**`tsconfig.resolve.json` is not part of any build.** It exists so the architecture plugin can resolve
specifiers, and it mirrors `tsconfig.base.json`'s `paths` _without_ the trailing extension those carry —
a mapped target is a template, so a `.ts`-suffixed mapping would make `pkg/x.js` look for `x.js.ts`.
Changing `paths` in one file and not the other is how rules silently stop resolving.

**Adding a layer means adding a node to `architecture.config.mjs`.** A new folder under `src/` that no
node governs trips the taxonomy-root catch-all rather than being quietly unpoliced. Before trusting a
rule you just wrote, plant the violation it exists to catch and watch `pnpm lint` fail — the probe check
proves a rule _can_ fire, not that it fires on what you meant.

**Imports use explicit `.js` extensions.** `moduleResolution` is `NodeNext` and the package is ESM —
`import { x } from "./thing.js"` referring to `thing.ts` is correct, not a mistake to "fix".

**`oxlint` and `@effect/tsgo` move together.** The `prepare` step runs `effect-tsgo patch --oxlint`,
and that patch targets one exact oxlint version, so a bump is the pair (`1.81.0` with `@effect/tsgo`
`^0.40.0`). Do not go below 1.78.0: 1.77.0's language server panics building the "disable this rule"
quick-fix for any JS-plugin diagnostic (oxc #25278), so the architecture rules ran in CI and never
surfaced in the editor. `.vscode/` points the editor at `oxc.oxc-vscode` for the same reason.

**`no-redeclare` is off on purpose.** From oxlint 1.79.0 the rule reports TypeScript declaration
merging — `export const X = Schema.Struct(…)` beside `export type X = …`, which is how every schema in
`src/domain/` is written. Upstream closed it as not planned (oxc #25936). A real redeclaration is
TS2451, and the compiler owns it.

**`effect` is an exact dependency** (`4.0.0-beta.94`), pinned again in the root `pnpm.overrides`. Effect
4 betas are mutually incompatible; bumping it is a coordinated breaking change.

**`references` is not inherited through `extends`**, so `tsconfig.build.json` and the root
`tsconfig.build.json` repeat what the plain `tsconfig.json` already lists.

## Conventions

- **Prettier**: double quotes, `printWidth: 100`, semicolons. (Note this differs from most dataquail
  repos — it matches the upstream these packages were extracted from.)
- **oxlint**, not ESLint. Local rules live in `scripts/lint-rules/` and are loaded as an oxlint JS
  plugin under the `local/` prefix. The config extends `@effect/tsgo`'s recommended preset, which is
  where the `effecttsgo/*` rules come from.
- **Conventional commits** are enforced by commitlint and drive `nx release` version bumps.
- **Nx targets** are declared in each `project.json` and delegate to the package's own npm scripts, so
  `pnpm --filter … run build` and `nx build …` do the same thing. Each `package.json` sets
  `"nx": { "includedScripts": [] }` so Nx does not also infer targets from the scripts.
- **Docs are namespaced per package.** `website/src/content/docs/architecture-rules/**` belongs to this
  package; a second library gets its own directory and its own sidebar group rather than being folded
  into this one.

## Architecture notes

`oxlint-architecture-rules` is itself laid out hexagonally, and the layering is the thing to preserve:

- `src/domain/` — the manifest schema, the error types, the `Violation` and its line-independent
  fingerprint. No I/O.
- `src/core/` — the pure evaluators (`imports`, `exports`, `members`, `surface`, `structure`, `graph`,
  `coverage`, `baseline`, `patterns`). Given facts, they return violations; they never read a file.
- `src/manifest/` — compiling the manifest tree down to flat, resolved rules (`lowerManifest`).
- `src/ports/` + `src/infrastructure/` — the `FileSystem`, `ModuleResolver` and `FactExtractor` ports,
  with a live implementation (`unrs-resolver`, `typescript`) and a fake per port. Tests drive the fakes.
  The extractor is the TypeScript parser the CLI reads every file through and the loader parses
  authored probes with; the plugin reads oxlint's tree instead, and `src/adapters/parity.test.ts`
  holds the two to one answer.
- `src/adapters/oxlint/` and `src/adapters/cli/` — the two delivery mechanisms. Both answer to the same
  core, deliberately, so an alpha oxlint plugin API is not a single point of failure.

Two properties are load-bearing and pinned by tests:

- **Every compiled rule carries a probe** generated from its own node path, and the plugin **refuses to
  load** if any probe fails. A rule that has drifted into matching nothing is a load-time error, not
  something a separate script might notice later. A `members`, `exports` or `surface` rule may carry
  an authored `probe: { source }` instead, parsed at load — the only way to prove a rule fires on a
  declaration shape, since a synthetic probe never meets a parser.
- **The baseline is a ratchet, not a suppression list.** Entries are keyed by fingerprint, and fixing a
  violation fails the build until its entry is removed, so the floor only rises.
- **The graph family is CLI-only, by design.** The plugin sees one file at a time; `architecture check`
  builds the import graph (parsing each file once) and is a superset of the plugin, not a mirror.
  Both adapters compile and probe graph rules at load, so a vacuous one fails `oxlint` too.

## Releasing

`nx release` with `projectsRelationship: "independent"`. Push to `main` → version + tag + GitHub
release; creating that release triggers the npm publish from `packages/<name>` (not a `dist/`
subdirectory — the manifest's `files` is what narrows the tarball). See `RELEASE.md`.

**A package that has never been released does not go through that path.** It has no git tag and no
registry version to derive from, so it is bootstrapped by the **First Publish** workflow
(`workflow_dispatch` → `scripts/first-publish.sh`), which passes nx's `--first-release` and refuses any
package that is already on the registry. After that one run the package is normal.

**`--preid` is passed once, on the first publish, and never again.** Once a package's current version
is a prerelease, nx resolves every subsequent bump as `prerelease` on its own, so the ordinary flow
keeps cutting betas with no flag anywhere. Leaving beta is therefore a deliberate
`nx release minor` — there is nothing to unset — which is the property you want from a "not ready yet"
state. Don't add a preid to `on-push.yml` trying to make betas stick; they already do.

**The npm dist-tag is derived from the version, not configured** (`scripts/dist-tag.mjs`, used by both
publish scripts). npm applies `latest` to whatever it is given unless `--tag` says otherwise and never
looks at the version, so an untagged beta becomes what `npm install` resolves to — which is exactly
what happened to `@effect-server-utils/cqrs` (`latest -> 0.1.0-beta.4`).

**`.npmrc` sets `provenance=true` unconditionally, and npm errors rather than degrades without a
trusted CI to attest from.** Any publish outside Actions — including a Verdaccio rehearsal — needs
`NPM_CONFIG_PROVENANCE=false`, and gives up the attestation to get it.
