import { OPEN_LAYOUT } from "../domain/architecture-config.js";
import type { CompiledGraph } from "./graph.js";
import type { CompiledImportRule } from "./imports.js";
import type { CompiledMemberRule } from "./members.js";
import { firstFromMatch } from "./patterns.js";
import type { CompiledStructure } from "./structure.js";
import type { CompiledSurfaceRule } from "./surface.js";

// A probe proves a rule can fire. This is the other question: does the tree
// actually reach the files? A file no allowlist selects, in a folder no layout
// enumerates, is a file the policy has nothing to say about — and a policy that
// is 40% silence looks exactly like one that is 100% enforced, until counted.

export type FamilyCoverage = {
  readonly covered: number;
  readonly total: number;
};

export type StructureCoverage = {
  // Its folder's files are listed by name.
  readonly enumerated: number;
  // Its folder is claimed, and admits any name — `layout: "open"`.
  readonly open: number;
  readonly total: number;
};

export type Coverage = {
  readonly files: number;
  // Under an import allowlist. An `unrestricted` tier emits none, so this is
  // the honest count of files whose imports are actually bounded.
  readonly imports: FamilyCoverage;
  readonly structure: StructureCoverage;
  readonly members: FamilyCoverage;
  readonly surface: FamilyCoverage;
  // In the scope of a cycles or orphans rule.
  readonly graph: FamilyCoverage;
};

export type CoverageInputs = {
  readonly importRules: ReadonlyArray<CompiledImportRule>;
  readonly structure: CompiledStructure;
  readonly memberRules: ReadonlyArray<CompiledMemberRule>;
  readonly surfaceRules: ReadonlyArray<CompiledSurfaceRule>;
  readonly graph: CompiledGraph;
};

// An allowlist names no `to`: it fires when the target matches none of its
// `toNot`. A prohibition names one. Only the former bounds a file.
const isAllowlist = (rule: CompiledImportRule): boolean =>
  rule.to.length === 0 && rule.toNot.length > 0;

const dirnameOf = (file: string): string => {
  const at = file.lastIndexOf("/");
  return at === -1 ? "" : file.slice(0, at);
};

const selects = (
  rule: { from: ReadonlyArray<RegExp>; fromNot: ReadonlyArray<RegExp> },
  file: string,
) => firstFromMatch(rule, file) !== null;

export const coverageOf = (policy: CoverageInputs, files: ReadonlyArray<string>): Coverage => {
  const allowlists = policy.importRules.filter(isAllowlist);
  let imports = 0;
  let enumerated = 0;
  let open = 0;
  let members = 0;
  let surface = 0;
  let graph = 0;

  for (const file of files) {
    if (allowlists.some((rule) => selects(rule, file))) imports += 1;

    const folder = dirnameOf(file);
    const governing = policy.structure.folders.filter((rule) =>
      rule.folder.some((pattern) => pattern.test(folder)),
    );
    if (governing.length > 0) {
      if (governing.every((rule) => rule.files.some((pattern) => pattern.source === OPEN_LAYOUT))) {
        open += 1;
      } else {
        enumerated += 1;
      }
    }

    if (policy.memberRules.some((rule) => selects(rule, file))) members += 1;
    if (policy.surfaceRules.some((rule) => selects(rule, file))) surface += 1;

    const scoped = [...policy.graph.cycles, ...policy.graph.orphans].some(
      (rule) =>
        rule.within.some((pattern) => pattern.test(file)) &&
        !rule.withinNot.some((pattern) => pattern.test(file)),
    );
    if (scoped) graph += 1;
  }

  const total = files.length;
  return {
    files: total,
    imports: { covered: imports, total },
    structure: { enumerated, open, total },
    members: { covered: members, total },
    surface: { covered: surface, total },
    graph: { covered: graph, total },
  };
};

// A floor the policy states for itself, per family, as a fraction. Structure
// counts enumerated folders only: an open one is claimed, not policed by name.
export type CoverageFloors = {
  readonly imports?: number;
  readonly structure?: number;
  readonly members?: number;
  readonly surface?: number;
  readonly graph?: number;
};

export type CoverageFamily = keyof CoverageFloors;

export const fractionOf = (covered: number, total: number): number =>
  total === 0 ? 1 : covered / total;

export const fractionsOf = (coverage: Coverage): Readonly<Record<CoverageFamily, number>> => ({
  imports: fractionOf(coverage.imports.covered, coverage.imports.total),
  structure: fractionOf(coverage.structure.enumerated, coverage.structure.total),
  members: fractionOf(coverage.members.covered, coverage.members.total),
  surface: fractionOf(coverage.surface.covered, coverage.surface.total),
  graph: fractionOf(coverage.graph.covered, coverage.graph.total),
});

export type Shortfall = {
  readonly family: CoverageFamily;
  readonly actual: number;
  readonly floor: number;
};

export const coverageShortfalls = (
  coverage: Coverage,
  floors: CoverageFloors,
): ReadonlyArray<Shortfall> => {
  const actual = fractionsOf(coverage);
  const families: ReadonlyArray<CoverageFamily> = [
    "imports",
    "structure",
    "members",
    "surface",
    "graph",
  ];
  return families.flatMap((family) => {
    const floor = floors[family];
    if (floor === undefined || actual[family] >= floor) return [];
    return [{ family, actual: actual[family], floor }];
  });
};
