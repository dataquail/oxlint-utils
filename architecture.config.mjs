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
export default {
  // Where a repository adopting this policy records the violations it is
  // carrying. This one has none, so the file is absent — and `architecture
  // baseline` would write an empty list rather than a place to hide.
  baseline: ".architecture-baseline.json",

  resolve: {
    // Only `packages/` is policed. The docs site is Astro, whose `astro:*`
    // virtual modules resolve to nothing on disk, and a scope that cannot
    // resolve its own imports would report noise rather than architecture.
    scopes: [{ files: "^packages/", tsconfig: "tsconfig.resolve.json" }],
    // An import nobody can resolve is an import no rule can police. Loud by
    // default; anything listed here needs a reason next to it.
    unresolved: "error",
    ignoreUnresolved: [],
  },

  aliases: {
    "~": "packages",
    "@arch": "packages/oxlint-architecture-rules/src",
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
          children: {
            "domain/": {
              message:
                "domain/ is the model: the manifest schema, the error types, and the Violation with its line-independent fingerprint. No I/O, and nothing above it.",
              layout: "open",
              children: {},
              imports: {
                message:
                  "domain/ is the bottom of the graph. It reaches itself and the runtime, and nothing else in the package.",
                allow: ["@arch/domain/**"],
              },
            },

            "ports/": {
              message:
                "ports/ declares the two things this package must touch — a file system and a module resolver — as interfaces, so the core can be tested without either.",
              layout: "open",
              children: {},
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
              children: {},
              imports: {
                message:
                  "An adapter implements a port. It reaches the port it satisfies, the domain types in that signature, and its own siblings.",
                external: ["unrs-resolver"],
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
