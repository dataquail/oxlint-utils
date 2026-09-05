import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import {
  type Baseline,
  baselineOf,
  coverageOf,
  coverageShortfalls,
  decodeBaseline,
  EMPTY_BASELINE,
  evaluateGraph,
  evaluateMemberSite,
  evaluateSelectedBindings,
  evaluateSelectedEdge,
  evaluateStructure,
  evaluateSurface,
  exportRulesSelecting,
  fingerprintOf,
  formatMessage,
  fractionsOf,
  hasGraphRules,
  listSourceFiles,
  memberRulesSelecting,
  requiredSiblingsOf,
  rulesSelecting,
  serializeBaseline,
  type SourceFacts,
  staleEntriesOf,
  surfaceRulesSelecting,
  unbaselined,
  type Violation,
} from "@goodbones/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { type LoadedPolicy, loadPolicyFromFile } from "./config-loader.js";
import { buildGraph } from "./graph.js";
import { sourceFactsOf } from "./source-facts.js";

// The policy, run with no linter in the loop.
//
// oxlint's JS plugin API is alpha, and a policy that can only be evaluated by
// one alpha host is a policy with a single point of failure. This adapter is the
// second way to ask the same question — and the only way to write a baseline,
// since that needs every finding at once rather than one file at a time.
//
// It covers all four families. The two that need a syntax tree read TypeScript's
// rather than oxlint's; both adapters meet at the same vocabulary — a specifier,
// a binding, a member site — so they answer to the same core rather than to each
// other.

export type CliFailure = { readonly _tag: "CliFailure"; readonly message: string };

const fail = (message: string): CliFailure => ({ _tag: "CliFailure", message });

export type Findings = {
  readonly violations: ReadonlyArray<Violation>;
  readonly unresolved: ReadonlyArray<string>;
  readonly files: number;
};

export const collectFindings = (policy: LoadedPolicy, roots: ReadonlyArray<string>): Findings => {
  const files = listSourceFiles(policy.repoRoot, roots, policy.languages);
  const violations: Array<Violation> = [];
  const unresolved: Array<string> = [];

  // Each file is parsed at most once, whether the per-file families or the
  // graph pass asks first.
  const parsed = new Map<string, SourceFacts>();
  const factsOf = (file: string): SourceFacts => {
    const cached = parsed.get(file);
    if (cached !== undefined) return cached;
    const facts = sourceFactsOf(policy.repoRoot, file, policy.extractor);
    parsed.set(file, facts);
    return facts;
  };

  // The graph is the whole repository resolved at once — the one question no
  // per-file adapter can ask — and is built only when a rule needs it.
  if (hasGraphRules(policy.graph)) {
    for (const violation of evaluateGraph(
      policy.graph,
      buildGraph(files, policy.resolver, factsOf),
    )) {
      violations.push(violation);
    }
  }

  for (const file of files) {
    for (const violation of evaluateStructure(policy.structure, policy.fileSystem, file)) {
      violations.push(violation);
    }

    const selectedImports = rulesSelecting(policy.importRules, file);
    const selectedExports = exportRulesSelecting(policy.exportRules, file);
    const selectedMembers = memberRulesSelecting(policy.memberRules, file);
    const selectedSurface = surfaceRulesSelecting(policy.surfaceRules, file);
    if (
      selectedImports.length +
        selectedExports.length +
        selectedMembers.length +
        selectedSurface.length ===
      0
    ) {
      continue;
    }

    const facts = factsOf(file);

    for (const violation of evaluateSurface(selectedSurface, file, facts.exportSites)) {
      violations.push(violation);
    }

    for (const site of facts.memberSites) {
      for (const violation of evaluateMemberSite(selectedMembers, site)) violations.push(violation);
    }

    for (const specifier of facts.specifiers) {
      const edge = { importer: file, specifier };

      const imported = evaluateSelectedEdge(selectedImports, policy.resolver, edge);
      if (Result.isFailure(imported)) {
        if (policy.config.resolve.unresolved === "off") continue;
        if (policy.ignoreUnresolved.some((pattern) => pattern.test(specifier))) continue;
        unresolved.push(`${file} → ${specifier} (${imported.failure.detail})`);
        continue;
      }
      for (const violation of imported.success) violations.push(violation);

      const bound = facts.bindings.get(specifier) ?? [];
      const exported = evaluateSelectedBindings(selectedExports, policy.resolver, {
        ...edge,
        bindings: bound,
      });
      if (!Result.isFailure(exported)) {
        for (const { violation } of exported.success) violations.push(violation);
      }
    }
  }

  return { violations, unresolved, files: files.length };
};

const baselinePathOf = (policy: LoadedPolicy): string | null =>
  policy.config.baseline === undefined
    ? null
    : path.resolve(policy.repoRoot, policy.config.baseline);

const readBaseline = (policy: LoadedPolicy): Baseline => {
  const at = baselinePathOf(policy);
  if (at === null) return EMPTY_BASELINE;
  try {
    return decodeBaseline(JSON.parse(readFileSync(at, "utf8")) as unknown);
  } catch {
    return EMPTY_BASELINE;
  }
};

const report = (lines: ReadonlyArray<string>): Effect.Effect<void> =>
  Effect.sync(() => {
    for (const line of lines) process.stdout.write(`${line}\n`);
  });

const describe = (violation: Violation): string =>
  `  ${violation.file}\n      ${formatMessage(violation)}`;

export const check = (
  policy: LoadedPolicy,
  roots: ReadonlyArray<string>,
): Effect.Effect<void, CliFailure> =>
  Effect.gen(function* () {
    const findings = collectFindings(policy, roots);
    const baseline = readBaseline(policy);
    const reportable = unbaselined(baseline, findings.violations);
    const stale = staleEntriesOf(baseline, findings.violations);

    yield* report(reportable.map(describe));
    yield* report(findings.unresolved.map((one) => `  unresolved: ${one}`));

    const carried = findings.violations.length - reportable.length;
    yield* report([
      "",
      `${String(findings.files)} files, ${String(reportable.length)} violations` +
        (carried > 0 ? `, ${String(carried)} carried by the baseline` : ""),
    ]);

    if (stale.length > 0) {
      // The ratchet: a fixed violation must leave the baseline, or the floor
      // never rises and the file stops describing anything real.
      yield* report([
        "",
        `${String(stale.length)} baseline entries no longer fire. The code was fixed; prune them:`,
        ...stale.map((entry) => `  ${entry}`),
        "",
        "  architecture baseline    # rewrites the file from what still fires",
      ]);
      return yield* Effect.fail(fail("stale baseline entries"));
    }

    // The floors. A policy states how much of the tree it reaches, per
    // family; falling under is a policy that quietly stopped covering files.
    const floors = policy.config.limits?.coverage;
    const shortfalls =
      floors === undefined
        ? []
        : coverageShortfalls(
            coverageOf(policy, listSourceFiles(policy.repoRoot, roots, policy.languages)),
            floors,
          );
    if (shortfalls.length > 0) {
      yield* report([
        "",
        "coverage is below the floor the policy states for itself:",
        ...shortfalls.map(
          (one) => `  ${one.family}: ${percent(one.actual)} covered, floor ${percent(one.floor)}`,
        ),
        "",
        "  architecture coverage    # which files no rule reaches",
      ]);
      return yield* Effect.fail(fail("coverage below floor"));
    }

    if (reportable.length > 0 || findings.unresolved.length > 0) {
      return yield* Effect.fail(fail("architecture violations"));
    }
  });

const percent = (fraction: number): string => `${String(Math.floor(fraction * 100))}%`;

// How much of the tree the policy reaches. A probe proves a rule can fire;
// this is whether the files are there to fire on. Reported per family, with the
// adoption backlog — the tiers that said "not tightened yet" — beneath it.
export const coverage = (
  policy: LoadedPolicy,
  roots: ReadonlyArray<string>,
): Effect.Effect<void, CliFailure> =>
  Effect.gen(function* () {
    const files = listSourceFiles(policy.repoRoot, roots, policy.languages);
    const found = coverageOf(policy, files);
    const fractions = fractionsOf(found);
    const floors = policy.config.limits?.coverage ?? {};
    const row = (family: keyof typeof fractions, covered: number, note: string): string => {
      const floor = floors[family];
      const mark =
        floor === undefined
          ? ""
          : fractions[family] >= floor
            ? `  ≥ ${percent(floor)} ✓`
            : `  < ${percent(floor)} ✗`;
      return `  ${family.padEnd(10)} ${String(covered).padStart(5)}/${String(found.files)}  ${percent(fractions[family]).padStart(4)}  ${note}${mark}`;
    };

    yield* report([
      `${String(found.files)} files under ${roots.join(", ")}`,
      "",
      row("imports", found.imports.covered, "under an import allowlist"),
      row(
        "structure",
        found.structure.enumerated,
        `in an enumerated folder (${String(found.structure.open)} in an open one, ${String(found.structure.total - found.structure.enumerated - found.structure.open)} in none)`,
      ),
      row("members", found.members.covered, "selected by a members rule"),
      row("surface", found.surface.covered, "selected by a surface rule"),
      row("graph", found.graph.covered, "in a cycles or orphans scope"),
      "",
      `  unrestricted tiers: ${policy.adoption.unrestricted.length === 0 ? "(none)" : policy.adoption.unrestricted.join(", ")}`,
      `  partial tiers:      ${policy.adoption.partial.length === 0 ? "(none)" : policy.adoption.partial.join(", ")}`,
    ]);
  });

export const writeBaseline = (
  policy: LoadedPolicy,
  roots: ReadonlyArray<string>,
): Effect.Effect<void, CliFailure> =>
  Effect.gen(function* () {
    const at = baselinePathOf(policy);
    if (at === null) {
      return yield* Effect.fail(
        fail("this policy declares no `baseline` path, so there is nowhere to write one"),
      );
    }

    const findings = collectFindings(policy, roots);
    const baseline = baselineOf(findings.violations);
    yield* Effect.sync(() => {
      writeFileSync(at, serializeBaseline(baseline));
    });
    yield* report([
      `${String(baseline.entries.length)} violations recorded in ${path.relative(policy.repoRoot, at)}.`,
      "Each one is debt the policy is carrying. Fixing one means deleting its line.",
    ]);
  });

// The question a tree config makes harder to answer than a flat one: given a
// file, what governs it? A flat config you grep; a tree you have to walk.
export const explain = (policy: LoadedPolicy, file: string): Effect.Effect<void, CliFailure> =>
  Effect.gen(function* () {
    const relative = path.relative(policy.repoRoot, path.resolve(policy.repoRoot, file));
    const selected = rulesSelecting(policy.importRules, relative);

    // An allowlist rule names no `to` — it fires when the target matches none of
    // its patterns. A prohibition names one.
    const allowlists = selected.filter(([rule]) => rule.to.length === 0 && rule.toNot.length > 0);
    const prohibitions = selected.filter(([rule]) => rule.to.length > 0);

    const owed = policy.structure.parity
      .filter(
        (rule) =>
          rule.file.some((pattern) => pattern.test(relative)) &&
          !rule.fileNot.some((pattern) => pattern.test(relative)),
      )
      .flatMap((rule) => requiredSiblingsOf(rule, relative));

    const governing = policy.structure.folders.filter((rule) =>
      rule.folder.some((pattern) => pattern.test(path.dirname(relative))),
    );

    const naming = policy.structure.naming.filter(
      (rule) =>
        rule.file.some((pattern) => pattern.test(relative)) &&
        !rule.fileNot.some((pattern) => pattern.test(relative)),
    );

    const firstSentence = (message: string) => `${message.split(". ")[0] ?? message}.`;
    const named = (rule: { readonly name: string; readonly message: string }): string =>
      `    ${rule.name} — ${firstSentence(rule.message)}`;

    // The families beyond imports and structure: which rules of each speak to
    // this file at all. What they are evaluated against is `facts`' answer.
    const restricted = exportRulesSelecting(policy.exportRules, relative).map(([rule]) => rule);
    const vocabulary = memberRulesSelecting(policy.memberRules, relative);
    const surface = surfaceRulesSelecting(policy.surfaceRules, relative);
    const scoped = (rule: { within: ReadonlyArray<RegExp>; withinNot: ReadonlyArray<RegExp> }) =>
      rule.within.some((pattern) => pattern.test(relative)) &&
      !rule.withinNot.some((pattern) => pattern.test(relative));
    const graph = [
      ...policy.graph.cycles.filter(scoped).map((rule) => `${named(rule)} (cycles)`),
      ...policy.graph.orphans.filter(scoped).map((rule) => `${named(rule)} (orphans)`),
      ...policy.graph.reach
        .filter(
          (rule) =>
            rule.from.some((pattern) => pattern.test(relative)) &&
            !rule.fromNot.some((pattern) => pattern.test(relative)),
        )
        .map((rule) => `${named(rule)} (reach)`),
    ];
    const section = (title: string, lines: ReadonlyArray<string>): ReadonlyArray<string> =>
      lines.length === 0 ? [] : ["", title, ...lines];

    yield* report([
      relative,
      "",
      allowlists.length === 0
        ? "  may import: anything (no tier above this file states an allowlist)"
        : "  may import:",
      ...allowlists.flatMap(([rule]) => [
        `    — ${rule.name}`,
        ...rule.toNot.map((pattern) => `        ${pattern}`),
        ...[...rule.externals].map((name) => `        external: ${name}`),
      ]),
      "",
      "  may not import:",
      ...(prohibitions.length === 0
        ? ["    (nothing beyond the allowlist above)"]
        : prohibitions.map(([rule]) => `    ${rule.name} — ${firstSentence(rule.message)}`)),
      "",
      `  lives in: ${governing.length === 0 ? "a folder no rule governs" : governing.map((rule) => rule.name).join(", ")}`,
      ...(naming.length === 0
        ? []
        : [
            "  is named by:",
            ...naming.map(
              (rule) =>
                `    ${rule.name} — ${rule.sameAs !== null ? "its folder's own name" : (rule.convention?.source ?? "")}`,
            ),
          ]),
      ...(owed.length === 0 ? [] : ["  owes:", ...owed.map((one) => `    ${one}`)]),
      ...section("  may not name (exports):", restricted.map(named)),
      ...section("  vocabulary (members):", vocabulary.map(named)),
      ...section("  may export (surface):", surface.map(named)),
      ...section("  graph:", graph),
    ]);
  });

// The other half of `explain`. `explain` says which rules select a file; this
// says what those rules are evaluated against — every edge the parser found,
// the names carried across each, every declared member and called name. A rule
// that "should fire" and does not is one of two mistakes, and this is how to
// tell them apart: the pattern does not select the site, or the site is not a
// fact the adapter extracts.
export const facts = (
  policy: LoadedPolicy,
  file: string,
  format: "text" | "json" = "text",
): Effect.Effect<void, CliFailure> =>
  Effect.gen(function* () {
    const relative = path
      .relative(policy.repoRoot, path.resolve(policy.repoRoot, file))
      .replaceAll(path.sep, "/");

    const read = yield* Effect.try({
      try: () => sourceFactsOf(policy.repoRoot, relative, policy.extractor),
      catch: (cause) => fail(`could not read ${relative}: ${String(cause)}`),
    });

    const edges = read.specifiers.map((specifier) => ({
      specifier,
      bindings: read.bindings.get(specifier) ?? [],
    }));
    const declared = read.memberSites.filter((site) => site.subject === "members");
    const called = read.memberSites.filter((site) => site.subject === "calls");

    if (format === "json") {
      return yield* report([
        JSON.stringify(
          { file: relative, edges, memberSites: read.memberSites, exportSites: read.exportSites },
          null,
          2,
        ),
      ]);
    }

    yield* report([
      relative,
      "",
      edges.length === 0 ? "  edges: (none)" : "  edges:",
      ...edges.flatMap(({ bindings, specifier }) => [
        `    ${specifier}`,
        ...(bindings.length === 0
          ? ["        (no bindings)"]
          : bindings.map((binding) => `        ${binding.kind.padEnd(9)} ${binding.symbol}`)),
      ]),
      "",
      declared.length === 0 ? "  members: (none)" : "  members:",
      ...declared.map((site) => `    ${site.in ?? ""}.${site.name}  (${site.declares ?? "other"})`),
      "",
      called.length === 0 ? "  calls: (none)" : "  calls:",
      ...called.map((site) => `    ${site.name}`),
      "",
      read.exportSites.length === 0 ? "  exports: (none)" : "  exports:",
      ...read.exportSites.map(
        (site) =>
          `    ${site.kind.padEnd(9)} ${site.name}  (${site.reexport ? "re-export" : site.declares})`,
      ),
    ]);
  });

export const run = (
  repoRoot: string,
  argv: ReadonlyArray<string>,
): Effect.Effect<void, CliFailure> =>
  Effect.gen(function* () {
    const [command = "check", ...rest] = argv;
    const policy = yield* Effect.tryPromise({
      try: () => loadPolicyFromFile(repoRoot),
      catch: (cause) => fail(String(cause)),
    });
    yield* Effect.sync(() => {
      for (const notice of policy.notices) process.stderr.write(`deprecated: ${notice}\n`);
    });

    const roots = rest.length > 0 ? rest : ["packages"];

    switch (command) {
      case "check":
        return yield* check(policy, roots);
      case "baseline":
        return yield* writeBaseline(policy, roots);
      case "explain": {
        const [file] = rest;
        if (file === undefined) return yield* Effect.fail(fail("explain needs a file path"));
        return yield* explain(policy, file);
      }
      case "coverage":
        return yield* coverage(policy, roots);
      case "facts": {
        const [file] = rest.filter((argument) => argument !== "--json");
        if (file === undefined) return yield* Effect.fail(fail("facts needs a file path"));
        return yield* facts(policy, file, rest.includes("--json") ? "json" : "text");
      }
      default:
        return yield* Effect.fail(
          fail(
            `unknown command "${command}". Try: check | baseline | coverage | explain <file> | facts <file> [--json]`,
          ),
        );
    }
  });

export const fingerprint = fingerprintOf;
