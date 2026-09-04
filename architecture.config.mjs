// The architecture policy: every boundary in this monorepo, as one manifest.
//
// It reads like a directory listing — a key ending in `/` is a folder, anything
// else is a file — and everything the architecture says about a part of the tree
// is written at that part of the tree: what it may import, who may import it,
// which names it may declare, and which siblings its files owe.
//
// Patterns are globs over repo-relative paths, matched against FULLY RESOLVED
// targets:
//
//   *          part of one path segment          {name}   captures one segment
//   **         any number of segments            [A-Z]    a character class
//   a/**       `a` itself as well as a/b/c       |        several patterns, one node
//
// The default is tight. A folder admits only the children it lists; a file may
// import only what it or an ancestor allows. Laxity is opted into by name:
// `reset` drops inherited allowances, `unrestricted` says a tier has no
// allowlist yet, `layout: "open"` says a folder does not enumerate its files.
//
// Every rule this compiles to carries a probe it must report, generated from the
// node's own path. The plugin refuses to load if any rule fails its own — a rule
// that has drifted into matching nothing is the failure this whole apparatus
// exists to prevent.
//
// This repository publishes the plugin that reads this file, so the policy is
// also the package's largest test: a change that breaks lowering breaks the lint
// run here first.

/** @type {import("oxlint-architecture-rules").Manifest} */
// "Given facts, they return violations; they never read a file." Stated as a
// rule about calls rather than about imports: an import allowlist stops
// `node:fs` at the door, but a `readFileSync` handed in as a callback, or
// reached through a helper, is the same violation with no edge to catch.
const NO_FILE_SYSTEM_CALLS = {
  message:
    "`{name}` reads or writes the file system. This tier is given facts and returns violations; the file system is behind a port, and the port is what it takes.",
  subject: "calls",
  match: ["*Sync", "readFile", "readdir", "writeFile", "require"],
  probe: {
    source: 'import { readFileSync } from "node:fs"; readFileSync("x");',
    name: "readFileSync",
  },
};

export default {
  // Where a repository adopting this policy records the violations it is
  // carrying. This one has none, so the file is absent — and `architecture
  // baseline` would write an empty list rather than a place to hide.
  baseline: ".architecture-baseline.json",

  resolve: {
    // Only `packages/` is policed. The docs site is Astro, whose `astro:*`
    // virtual modules resolve to nothing on disk, and a scope that cannot
    // resolve its own imports would report noise rather than architecture.
    scopes: [
      {
        files: "^packages/",
        language: "typescript",
        options: { tsconfig: "tsconfig.resolve.json" },
      },
    ],
    // An import nobody can resolve is an import no rule can police. Loud by
    // default; anything listed here needs a reason next to it.
    unresolved: "error",
    ignoreUnresolved: [],
  },

  aliases: {
    "~": "packages",
    "@arch": "packages/oxlint-architecture-rules/src",
  },

  // Which exported names may cross which edges — the family a path rule cannot
  // express, because every importer of a module resolves to the same file.
  exports: [
    {
      name: "live-adapters-at-the-composition-root",
      message:
        "A live adapter is constructed once, where the package is composed. Everything else takes the port it satisfies, or the fake — which is what lets it be tested without a file system or a resolver.",
      module: "@arch/infrastructure/*-live.ts",
      symbols: ["makeFileSystemLive", "makeModuleResolverLive", "makeFactExtractorLive"],
      except: [
        "@arch/adapters/oxlint/config-loader.ts",
        // A language pack is what assembles the live extractor and resolver
        // for its language, so it is the one other place that may name them.
        "@arch/infrastructure/languages/*/index.ts",
        "@arch/index.ts",
        "**/*.test.ts",
      ],
      probe: {
        source: 'import { makeFileSystemLive } from "../infrastructure/file-system-live.js";',
        symbol: "makeFileSystemLive",
      },
    },
    {
      name: "language-packs-at-the-composition-root",
      message:
        "A language pack is constructed where the package is composed, and handed down as the `Language` port. Nothing in between names TypeScript — which is what lets a second language be added without editing the core.",
      module: "@arch/infrastructure/languages/*/index.ts",
      symbols: ["typescriptLanguage"],
      except: ["@arch/index.ts", "**/*.test.ts"],
      probe: {
        source:
          'import { typescriptLanguage } from "../infrastructure/languages/typescript/index.js";',
        symbol: "typescriptLanguage",
      },
    },
    {
      name: "name-what-you-take",
      message:
        "Name what you take from a sibling module. A namespace import or an `export *` takes every export at once, hides which are used, and launders a restricted name past every rule about it.",
      module: "@arch/**",
      kinds: ["namespace"],
      probe: { source: 'import * as imports from "../core/imports.js";', symbol: "*" },
    },
  ],

  // Ratchets on the policy itself. No tier here says "not tightened yet", and
  // the ceilings say none may start to without this line changing. The floors
  // are the reach `architecture coverage` reported when they were written.
  limits: {
    unrestricted: 0,
    partial: 0,
    // Every folder here is `layout: "open"`, so structure is 0% enumerated and
    // states no floor. The rest are the numbers on the day they were written
    // (members: 26/67 on 2026-09-04, after the language pack and the npm
    // package helper joined infrastructure/, which no members rule selects).
    coverage: { imports: 1, members: 0.38, surface: 0.98, graph: 0.61 },
  },

  // The shape of the whole graph — evaluated by `architecture check`, which
  // is the one adapter that sees every file at once.
  graph: {
    cycles: [
      {
        name: "no-cycles",
        message:
          "These files import each other, directly or through others. A cycle is a module boundary that does not exist.",
        within: "@arch/**",
        withinNot: "**/*.test.ts",
      },
    ],
    orphans: [
      {
        name: "no-dead-modules",
        message:
          "Nothing imports this file. A module nothing reaches is either dead, or an entry point this policy has not listed.",
        within: "@arch/**",
        withinNot: "**/*.test.ts",
        entry: ["@arch/index.ts", "@arch/adapters/oxlint/plugin.ts", "@arch/adapters/cli/main.ts"],
      },
    ],
    reach: [
      {
        name: "pure-tiers-reach-no-adapter",
        message:
          "The pure tiers — domain, ports, core, manifest — reach no live implementation and no delivery adapter, through any number of hops. That is what makes them testable without one.",
        from: ["@arch/domain/**", "@arch/ports/**", "@arch/core/**", "@arch/manifest/**"],
        fromNot: "**/*.test.ts",
        to: ["@arch/infrastructure/*-live.ts", "@arch/adapters/**"],
      },
      {
        name: "pure-tiers-reach-no-language-pack",
        message:
          "The pure tiers reach no language pack, through any number of hops. The manifest vocabulary is not TypeScript's; a second language is a second pack, not an edit to the core.",
        from: ["@arch/domain/**", "@arch/ports/**", "@arch/core/**", "@arch/manifest/**"],
        fromNot: "**/*.test.ts",
        to: "@arch/infrastructure/languages/**",
      },
    ],
  },

  tree: {
    "~/oxlint-architecture-rules/": {
      message:
        "oxlint-architecture-rules is a hexagon: a pure domain and core, ports for the two things it must touch, live and fake implementations behind them, and two delivery adapters that both answer to the same core.",
      // The package root holds config files, not a taxonomy worth enumerating.
      layout: "open",
      // The floor every tier inherits: node builtins, the runtime, and the test
      // framework. Each tier below adds the repository paths it may reach; none
      // of them `reset`, so this floor cannot be dropped further down.
      imports: {
        message: "This import is not on this tier's allowlist.",
        external: ["effect", "vitest"],
        allow: ["node:**", "vitest.shared.ts"],
      },
      children: {
        "src/": {
          layout: "open",
          // The plugin entry is the one default export: oxlint reads a plugin
          // as a module's default. Everything else has a name to grep for.
          surface: [
            {
              message:
                "No default exports. A default has no name to grep for, and every importer may call it something different.",
              kinds: ["default"],
              except: ["@arch/adapters/oxlint/plugin.ts"],
              probe: { source: "export default function main() {}" },
            },
            {
              message:
                "Re-export by name, so a barrel says what the module is. `export *` takes every export at once and launders a restricted name through the barrel.",
              kinds: ["namespace"],
            },
          ],
          children: {
            "domain/": {
              message:
                "domain/ is the model: the manifest schema, the error types, and the Violation with its line-independent fingerprint. No I/O, and nothing above it.",
              layout: "open",
              children: {},
              members: [NO_FILE_SYSTEM_CALLS],
              imports: {
                message:
                  "domain/ is the bottom of the graph. It reaches itself and the runtime, and nothing else in the package.",
                allow: ["@arch/domain/**"],
              },
            },

            "ports/": {
              message:
                "ports/ declares the things this package must touch — a file system, a module resolver, a parser — as interfaces, so the core can be tested without any of them.",
              layout: "open",
              children: {},
              members: [
                {
                  message:
                    'A port member is a verb in camelCase: "{name}" is not. The port is the vocabulary every adapter must speak, and its case is part of the contract.',
                  subject: "type-members",
                  allow: "[a-z]*",
                  probe: {
                    source:
                      "export type FileSystem = { readonly Exists: (path: string) => boolean };",
                    name: "Exists",
                  },
                },
              ],
              imports: {
                message:
                  "A port is a declaration. It may name the domain types that appear in its signatures, and nothing else.",
                allow: ["@arch/domain/**", "@arch/ports/**"],
              },
            },

            "core/": {
              message:
                "core/ holds the pure evaluators — imports, exports, members, structure, baseline, patterns. Given facts, they return violations; they never read a file.",
              layout: "open",
              children: {},
              members: [NO_FILE_SYSTEM_CALLS],
              imports: {
                message:
                  "core/ evaluates. It reaches the domain, the ports it is given, and its own siblings — never a live adapter, which is what lets every rule here be tested against a fake.",
                allow: [
                  "@arch/domain/**",
                  "@arch/ports/**",
                  "@arch/core/**",
                  // A core test drives the fakes, which is the whole point of
                  // the ports. The pattern names the fakes specifically, so a
                  // test reaching a *live* adapter is still refused.
                  "@arch/infrastructure/*-fake.ts",
                ],
              },
            },

            "manifest/": {
              message:
                "manifest/ compiles the authored manifest tree down to the flat, resolved rules the core evaluates, and generates each rule's probe while it does.",
              layout: "open",
              children: {},
              imports: {
                message:
                  "Lowering is a transformation of the domain types. It reaches the domain and its own siblings; it does not evaluate, and it does not resolve.",
                allow: ["@arch/domain/**", "@arch/manifest/**"],
              },
            },

            "infrastructure/": {
              message:
                "infrastructure/ implements the ports twice over: a live adapter for real work and a fake for tests. Nothing else in the package may name what it depends on.",
              layout: "open",
              children: {
                "languages/": {
                  message:
                    "languages/ holds one pack per language: the extractor and the resolver for it, assembled behind the Language port. The rest of the package speaks the port and never the language.",
                  layout: "open",
                  children: {
                    "{language}/": {
                      message:
                        "A language pack is one folder, named for its language, with an index.ts that assembles the pack.",
                      layout: "open",
                      children: {},
                    },
                  },
                },
              },
              imports: {
                message:
                  "An adapter implements a port. It reaches the port it satisfies, the domain types in that signature, and its own siblings.",
                external: ["unrs-resolver", "typescript"],
                allow: ["@arch/domain/**", "@arch/ports/**", "@arch/infrastructure/**"],
              },
            },

            "adapters/": {
              message:
                "adapters/ holds the two delivery mechanisms — the oxlint plugin and the CLI. Both answer to the same core, deliberately, so an alpha plugin API is not a single point of failure.",
              layout: "open",
              children: { "**/": { layout: "open", children: {} } },
              imports: {
                message:
                  "A delivery adapter composes the package. It is the one tier that may name every other, and the only one that may name the linter or the compiler.",
                external: ["typescript", "oxlint"],
                allow: ["@arch/**"],
              },
            },

            // The published barrel, and the package's own vitest config beside it.
            "*.ts": {
              imports: {
                message:
                  "The barrel re-exports the package's public surface, so it names every tier.",
                allow: ["@arch/**"],
              },
            },
          },
        },

        "**/": { layout: "open", children: {} },
      },
    },
  },
};
