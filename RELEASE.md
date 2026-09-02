# Release Process

Packages in this repository are versioned and published **independently**: a change confined to
`oxlint-architecture-rules` bumps and releases only that package.

## Prerequisites

Repository secrets:

| Secret                                           | Used for                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `NPM_TOKEN`                                      | publishing to npm, with provenance                                             |
| `VERSION_BUMPER_APPID` / `VERSION_BUMPER_SECRET` | a GitHub App token, so release commits and tags can push to a protected `main` |
| `NX_CLOUD_ACCESS_TOKEN`                          | optional, remote task cache                                                    |

You also need publish rights on each package name on npm.

## The normal path

1. **Merge a conventional commit to `main`.**

   `feat:` → minor, `fix:` → patch, `feat!:` or a `BREAKING CHANGE:` footer → major. Nx maps each commit
   to the projects it touched, which is what makes independent versioning work.

2. **`.github/workflows/on-push.yml` runs.** Lint, test and typecheck on affected projects, then:

   ```sh
   pnpm exec nx run-many -t build --projects='packages/*'
   npx nx release --skip-publish
   ```

   That versions each changed package, commits `chore: updated version [no ci]`, tags it as
   `<pkg>@<version>`, and creates a GitHub release per package.

3. **`.github/workflows/publish.yml` runs on release creation**, executing `scripts/publish.sh`:
   build → `nx release publish` → verify each version reached the registry.

That path derives everything from what came before: the previous git tag says what the current version
is, and the registry says whether a version is already out. A package that has never been released has
neither, which is what the **First Publish** workflow below exists for.

Packages are published from `packages/<name>` itself — the build emits into `build/` and the manifest's
`files` narrows the tarball — so `nx-release-publish` sets `packageRoot` to `{projectRoot}` in
`nx.json`. It also sets `access: public`, which is a no-op for an unscoped name and the thing that makes
the first publish of a scoped one work.

Note that the release tag for an unscoped package is `<pkg>@<version>`, and `publish.yml` splits the tag
on its **last** `@` to recover the package name. That is what makes the split work for scoped and
unscoped names alike.

## Publishing a package for the first time

A new package has no git tag and no version on the registry, so there is nothing for the normal path to
derive from. Run the **First Publish** workflow (`workflow_dispatch`) instead:

| Input      | Meaning                                                                         |
| ---------- | ------------------------------------------------------------------------------- |
| `packages` | package names, comma- or space-separated — `oxlint-architecture-rules`          |
| `dry_run`  | checked by default: prints the plan and the tarball contents, publishes nothing |

It runs `scripts/first-publish.sh`, which:

1. **Refuses anything that is not a first publish.** A package already on the registry, or already
   carrying a release tag, is reported and nothing is built. This is a bootstrap tool, not a republish
   button, and it cannot be misused as one.
2. Builds the named packages.
3. `nx release --first-release --skip-publish` — bumps from the version on disk using conventional
   commits, commits, tags, and cuts the GitHub release.
4. `nx release publish --first-release --registry …` — publishes.
5. Verifies each version actually reached the registry.

Leave `dry_run` on for the first attempt. The dry run prints the tarball, and a first publish is exactly
when a wrong `files` or `exports` ships permanently — npm will not let you re-publish a version you
have unpublished.

Steps 3 and 4 are two commands rather than one `nx release` because only `nx release publish` accepts
`--registry`. Folded together, the preflight could check npmjs.org while the publish went somewhere
else, and a first publish is precisely when nobody would notice.

After it succeeds the package is a normal one: the next conventional commit on `main` versions it
through the usual flow.

### If npm returns E403 on a name that does not exist

That is almost always the token, not the workflow. **A granular access token restricted to selected
packages cannot create a new one** — it can only publish over names it already lists. The first publish
of a new package needs a token scoped to the whole account or org, or a classic Automation token.
`scripts/publish.sh` and `scripts/first-publish.sh` both say so when they see that combination.

## Dry runs

```sh
# what would be versioned, and to what
pnpm exec nx release --dry-run

# the very first release, with no prior tags to derive from
pnpm exec nx release --first-release --dry-run
```

## Publishing manually

Only if the workflow is unavailable:

```sh
pnpm install --frozen-lockfile
pnpm run build:packages
./scripts/publish.sh
```

`NODE_AUTH_TOKEN` must be set.

Note that `.npmrc` sets `provenance=true` unconditionally, and npm **fails** rather than degrades when
it cannot produce a provenance statement:

```
EUSAGE  Automatic provenance generation not supported for provider: null
```

So a publish from a laptop needs `NPM_CONFIG_PROVENANCE=false` to get off the ground, and loses the
provenance attestation by doing so. That is the main reason to publish from CI even the first time,
and the reason the First Publish workflow exists rather than a documented local procedure.

## Testing a publish locally

A Verdaccio registry is wired up, and it is worth using before a first publish — it exercises the real
`nx release publish` path, tarball and all, against a registry you can throw away.

```sh
pnpm exec nx local-registry     # http://localhost:4873, leave it running

# Register a throwaway user and capture its token
curl -XPUT -H "Content-type: application/json" \
  -d '{"name":"ci","password":"ci-test-password"}' \
  http://localhost:4873/-/user/org.couchdb.user:ci

# Then, in another shell — provenance off, because this is not a trusted CI
NPM_CONFIG_PROVENANCE=false pnpm exec nx release publish \
  --first-release --projects=<pkg> --registry http://localhost:4873
```

Storage lives in `tmp/local-registry/storage`; delete a package's directory there to rehearse a first
publish again.

## Versioning policy

Standard semver, with one wrinkle: `oxlint-architecture-rules` depends on `effect` at an **exact** beta
version.

Effect 4 betas are mutually incompatible, so moving to a newer one is treated as a breaking change.
Dependabot is configured not to open PRs for `effect` or `@effect/vitest` for that reason.

## After a release

- Confirm the GitHub release notes read sensibly — they are generated from the conventional commits.
- If the documented API changed, deploy the docs: run the **Deploy Documentation** workflow
  (`workflow_dispatch`), which builds `website/` and publishes it to GitHub Pages at
  <https://dataquail.github.io/oxlint-utils>.
