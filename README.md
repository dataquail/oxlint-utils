# Oxlint Utils

Oxlint plugins and tooling, published as independent packages.

| Package                                                           | What it does                                                                                                                                                                                       |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`oxlint-architecture-rules`](packages/oxlint-architecture-rules) | Architecture policy as one manifest of your repository: import boundaries over resolved module paths, restricted export sites, folder taxonomy with sibling parity, and declared-member allowlists |

📖 **[Documentation](https://dataquail.github.io/oxlint-utils)**

```sh
pnpm add -D oxlint-architecture-rules
```

## Repository layout

```
packages/
  oxlint-architecture-rules/   oxlint-architecture-rules
website/                       Astro + Starlight documentation site (GitHub Pages)
scripts/                       release tooling and the local oxlint rule plugin
```

This is an [Nx](https://nx.dev) workspace using pnpm workspaces. Packages are versioned and published
independently.

## Development

```sh
pnpm install

pnpm run build:packages   # tsc -b -> build/esm + build/dts
pnpm run test:packages    # vitest, per package
pnpm run check:all        # tsc -b, src and tests
pnpm lint                 # oxlint, type-aware, including this repo's own architecture policy
pnpm run lint:architecture # the same policy through the CLI, with no linter in the loop
pnpm run check:effect     # Effect language-service diagnostics

pnpm run precommit        # lint + test + check across the workspace

pnpm run dev:website      # docs site at localhost:4321
pnpm run build:website
```

Per-project targets run through Nx:

```sh
pnpm exec nx build oxlint-architecture-rules
pnpm exec nx test oxlint-architecture-rules
pnpm exec nx affected -t test
```

## The repository lints itself

`architecture.config.mjs` at the root is a real policy over `packages/`, enforced by the plugin this
repository publishes and wired into `.oxlintrc.json`. `pnpm lint` therefore fails on a layering
violation — a `domain/` file reaching an adapter, a `core/` evaluator reaching a live implementation —
and the policy doubles as the package's largest test.

## How a package is built

`tsc -b tsconfig.build.json` emits `build/esm` (JavaScript) and `build/dts` (declarations). That is the
whole build — no bundler and no CommonJS output, because oxlint loads a JS plugin with a bare dynamic
`import()` and the CLI is a Node ESM entrypoint. The package root is the publish root; `files` narrows
it to `build/` plus the sources the source maps point at.

## Releasing

Versioning is driven by [conventional commits](https://www.conventionalcommits.org) and packages are
released independently. Pushing to `main` runs lint, test and typecheck, then `nx release`, which
versions each package that changed, tags it, and opens a GitHub release. Publishing to npm happens when
that release is created.

See [RELEASE.md](RELEASE.md).

## Contributing

Commits must follow conventional-commit format — `nx release` derives version bumps from them and
commitlint enforces it on every commit and in CI.

## License

MIT
