#!/bin/bash

# Bootstrap the FIRST release of one or more packages, from a manual dispatch.
#
# The normal path is release-triggered: a conventional commit lands on `main`,
# `nx release` versions and tags the packages it touched, and creating that
# GitHub release triggers the npm publish. That path has nothing to derive from
# for a package that has never been released — no git tag, no version on the
# registry — so a new library has historically been published by hand.
#
# This script is the missing button. It is deliberately NOT a general-purpose
# publisher: it refuses any package that is already on the registry or already
# carries a release tag, so the only thing it can do is the one thing the normal
# flow cannot.
#
# Inputs (environment):
#   PACKAGES   required. Package names, comma- or whitespace-separated.
#   DRY_RUN    "true" (default) prints the plan and the tarball contents without
#              publishing. Anything else publishes for real.
#   PREID      prerelease identifier for the first version — "beta" gives
#              0.1.0-beta.0 instead of 0.1.0. Empty publishes a stable version.
#   REGISTRY   defaults to https://registry.npmjs.org

set -euo pipefail

REGISTRY="${REGISTRY:-https://registry.npmjs.org}"
DRY_RUN="${DRY_RUN:-true}"
PREID="${PREID:-}"

if [ -z "${PACKAGES:-}" ]; then
  echo "❌ PACKAGES is required — name at least one package to publish." >&2
  exit 1
fi

# Accept "a, b" and "a b" alike; a dispatch input is typed by a human.
read -r -a REQUESTED <<< "$(echo "$PACKAGES" | tr ',' ' ')"

if [ ${#REQUESTED[@]} -eq 0 ]; then
  echo "❌ PACKAGES parsed to nothing: '$PACKAGES'" >&2
  exit 1
fi

# --- What the workspace actually contains -----------------------------------
#
# Built once, so a typo is reported against the real list rather than as a
# resolution failure five steps later.

declare -a KNOWN_NAMES=()
declare -a KNOWN_DIRS=()
for manifest in packages/*/package.json; do
  [ -f "$manifest" ] || continue
  name=$(node -p "JSON.parse(require('fs').readFileSync('$manifest','utf8')).name")
  KNOWN_NAMES+=("$name")
  KNOWN_DIRS+=("$(dirname "$manifest")")
done

if [ ${#KNOWN_NAMES[@]} -eq 0 ]; then
  echo "❌ No packages found under packages/*." >&2
  exit 1
fi

directory_of() {
  local wanted="$1" i
  for i in "${!KNOWN_NAMES[@]}"; do
    if [ "${KNOWN_NAMES[$i]}" = "$wanted" ]; then
      echo "${KNOWN_DIRS[$i]}"
      return 0
    fi
  done
  return 1
}

# --- Preflight ---------------------------------------------------------------
#
# Every check runs against every requested package before anything is built, so
# a bad list fails as one report rather than one package at a time.

declare -a TARGETS=()
FAILED=0

echo "Preflight for ${#REQUESTED[@]} package(s) against $REGISTRY"
echo

for requested in "${REQUESTED[@]}"; do
  [ -z "$requested" ] && continue

  if ! directory=$(directory_of "$requested"); then
    echo "  ❌ $requested — no such package in this workspace."
    echo "     Known packages: ${KNOWN_NAMES[*]}"
    FAILED=1
    continue
  fi

  version=$(node -p "JSON.parse(require('fs').readFileSync('$directory/package.json','utf8')).version")

  # Already on the registry: this is not a first publish, and running `nx
  # release` here would cut a second version for a package the normal flow
  # already owns.
  if npm view "$requested" version --registry "$REGISTRY" >/dev/null 2>&1; then
    published=$(npm view "$requested" version --registry "$REGISTRY" 2>/dev/null)
    echo "  ❌ $requested — already published ($published)."
    echo "     This workflow only bootstraps a package that has never been released."
    echo "     Land a conventional commit on main and let the normal release flow version it."
    FAILED=1
    continue
  fi

  # A release tag with no registry version means a previous attempt got half way
  # — versioned and tagged, but never published. Re-running `nx release` would
  # cut ANOTHER version on top. The recovery is to publish the tag that exists,
  # not to make a new one, so stop and say so.
  if git tag --list "${requested}@*" | grep -q .; then
    existing=$(git tag --list "${requested}@*" | tr '\n' ' ')
    echo "  ❌ $requested — release tags already exist: $existing"
    echo "     It was versioned before but never reached the registry. Publish the"
    echo "     existing version instead:"
    echo "       pnpm exec nx release publish --first-release --projects=$requested"
    FAILED=1
    continue
  fi

  echo "  ✅ $requested — not on the registry, no release tags, will publish from $directory (currently $version)"
  TARGETS+=("$requested")
done

echo

if [ "$FAILED" -ne 0 ]; then
  echo "❌ Preflight failed. Nothing was built and nothing was published." >&2
  exit 1
fi

JOINED=$(IFS=,; echo "${TARGETS[*]}")

# --- Build -------------------------------------------------------------------
#
# `nx release` publishes what is on disk. Building first is what makes the
# tarball the current source rather than whatever a cache happened to hold.

echo "Building ${JOINED}..."
pnpm exec nx run-many -t build --projects="$JOINED"
echo

# --- Release: version, tag, changelog, GitHub release ------------------------
#
# `--first-release` is the flag this whole script exists to reach: it tells nx
# that the absence of a git tag and of a registry version is expected, so the
# version on disk is the base to bump from and the changelog does not assume a
# previous tag.
#
# Versioning and publishing are two commands rather than one `nx release`,
# because only `nx release publish` takes `--registry`. Folded into one call the
# preflight above could check npmjs.org while the publish went somewhere else —
# and a first publish is exactly when nobody would notice.

# `--skip-publish` already answers the publish prompt, and nx rejects it
# alongside `--yes` as mutually exclusive.
RELEASE_ARGS=(release --first-release --projects="$JOINED" --skip-publish)

# `--preid` turns the specifier conventional commits resolved into its
# prerelease equivalent: minor becomes preminor, so 0.0.0 becomes 0.1.0-beta.0
# rather than 0.1.0.
#
# It is only needed HERE, for the first version. Once a package's current
# version is a prerelease, nx resolves every subsequent bump as "prerelease"
# on its own — so the ordinary push-to-main flow keeps cutting betas with no
# flag anywhere, until someone deliberately releases a stable version.
if [ -n "$PREID" ]; then
  echo "Prerelease: first version will carry the preid \"$PREID\"."
  echo "Every release after this one stays on the prerelease track automatically."
  echo
  RELEASE_ARGS+=(--preid "$PREID")
fi

if [ "$DRY_RUN" = "true" ]; then
  echo "🔍 Dry run — no version bump, no tag, no release, no publish."
  echo "   Read the tarball contents below: a first publish is when a wrong"
  echo "   \`files\` or \`exports\` ships permanently."
  echo
  RELEASE_ARGS+=(--dry-run)
fi

echo "Versioning and tagging ${JOINED}..."
pnpm exec nx "${RELEASE_ARGS[@]}"
echo

# The dist-tag has to follow the version that versioning just produced, so it is
# resolved here rather than passed in. A prerelease published under `latest` is
# the version `npm install` hands out, which would defeat the point of the preid
# above. In a dry run nothing was written, so derive it from the version the
# release WOULD have produced by asking for the same bump.
FIRST_TARGET="${TARGETS[0]}"
FIRST_DIR=$(directory_of "$FIRST_TARGET")
NEW_VERSION=$(node -p "JSON.parse(require('fs').readFileSync('$FIRST_DIR/package.json','utf8')).version")

if [ "$DRY_RUN" = "true" ] && [ -n "$PREID" ]; then
  # Nothing was written to disk, so the on-disk version is still the pre-bump
  # one. Name the tag the preid asks for; the real run derives it from the
  # version that was actually written.
  DIST_TAG="$PREID"
else
  DIST_TAG=$(node scripts/dist-tag.mjs "$NEW_VERSION")
fi

PUBLISH_ARGS=(release publish --first-release --projects="$JOINED" --registry "$REGISTRY" --tag "$DIST_TAG")
if [ "$DRY_RUN" = "true" ]; then
  PUBLISH_ARGS+=(--dry-run)
fi

echo "Publishing ${JOINED} to ${REGISTRY} under dist-tag \"${DIST_TAG}\"..."
pnpm exec nx "${PUBLISH_ARGS[@]}"

if [ "$DRY_RUN" = "true" ]; then
  echo
  echo "✅ Dry run complete. Nothing was versioned, tagged or published."
  echo "   Re-run with dry_run unchecked to do it for real."
  exit 0
fi

# --- Verify ------------------------------------------------------------------
#
# The registry is the source of truth for whether this worked, not the exit
# code — the same reasoning as scripts/publish.sh, which has the long version.

echo
echo "Verifying against the registry..."

MISSING=()
for target in "${TARGETS[@]}"; do
  directory=$(directory_of "$target")
  version=$(node -p "JSON.parse(require('fs').readFileSync('$directory/package.json','utf8')).version")

  if npm view "$target@$version" version --registry "$REGISTRY" >/dev/null 2>&1; then
    echo "  ✅ $target@$version is on the registry"
  else
    echo "  ❌ $target@$version is NOT on the registry"
    MISSING+=("$target@$version")
  fi
done

if [ ${#MISSING[@]} -ne 0 ]; then
  echo
  echo "❌ These versions did not reach the registry:" >&2
  printf '   - %s\n' "${MISSING[@]}" >&2
  echo
  echo "   If npm rejected the publish with E403 on a name that does not exist," >&2
  echo "   the token is the likely cause: a granular access token restricted to" >&2
  echo "   selected packages cannot CREATE one. A first publish needs a token" >&2
  echo "   scoped to the whole account/org, or a classic Automation token." >&2
  exit 1
fi

echo
echo "✅ First publish complete. Subsequent releases go through the normal flow:"
echo "   a conventional commit on main versions and tags the package, and"
echo "   creating that GitHub release publishes it."

if [ -n "$PREID" ]; then
  echo
  echo "   This was a ${PREID} release, published under the \"${DIST_TAG}\" dist-tag —"
  echo "   \`npm install\` still resolves to nothing until a stable version exists."
  echo "   Every release from here stays on the ${PREID} track by itself. When the"
  echo "   library is ready, cut the stable one deliberately:"
  echo "     pnpm exec nx release minor --projects=${JOINED}"
fi
