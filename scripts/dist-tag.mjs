#!/usr/bin/env node
// Prints the npm dist-tag a given version should be published under.
//
//   node scripts/dist-tag.mjs 0.1.0-beta.3   ->  beta
//   node scripts/dist-tag.mjs 1.0.0          ->  latest
//
// npm applies `latest` to whatever you publish unless `--tag` says otherwise —
// it does NOT look at the version. So a prerelease published without a tag
// becomes the version `npm install <pkg>` hands out, which is the opposite of
// what a beta programme is for. That is not hypothetical: in the repository
// this workspace was modelled on, `@effect-server-utils/cqrs` has
// `latest -> 0.1.0-beta.4` for exactly this reason.
//
// Deriving the tag from the version rather than configuring it means nothing
// has to be remembered when the beta programme ends: the first stable version
// takes `latest` on its own, and no beta ever does.
import * as process from "node:process";

const version = process.argv[2];

if (version === undefined || version === "") {
  console.error("dist-tag: a version is required");
  process.exit(1);
}

// Everything after the first `-` and before any `+` build metadata.
const prerelease = /^[^-]+-([^+]+)/.exec(version)?.[1];

if (prerelease === undefined) {
  console.log("latest");
} else {
  // `0.1.0-beta.3` -> `beta`. A purely numeric prerelease (`0.1.0-0`) carries no
  // name to use as a tag, so it gets a generic one rather than a tag called "0".
  const named = prerelease.split(".").find((part) => !/^\d+$/.test(part));
  console.log(named ?? "prerelease");
}
