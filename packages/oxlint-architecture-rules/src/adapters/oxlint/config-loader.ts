import { readFileSync } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import * as Result from "effect/Result";

import {
  type BaselineFilter,
  decodeBaseline,
  EMPTY_BASELINE,
  makeBaselineFilter,
} from "../../core/baseline.js";
import {
  type CompiledExportRule,
  compileExportRules,
  exportRulesFailingTheirProbe,
} from "../../core/exports.js";
import {
  type CompiledGraph,
  compileGraphRules,
  graphRulesFailingTheirProbe,
} from "../../core/graph.js";
import {
  type CompiledImportRule,
  compileImportRules,
  rulesFailingTheirProbe,
} from "../../core/imports.js";
import {
  type CompiledMemberRule,
  compileMemberRules,
  memberRulesFailingTheirProbe,
} from "../../core/members.js";
import {
  type CompiledStructure,
  compileStructure,
  structureRulesFailingTheirProbe,
} from "../../core/structure.js";
import {
  type CompiledSurfaceRule,
  compileSurfaceRules,
  surfaceRulesFailingTheirProbe,
} from "../../core/surface.js";
import { ConfigInvalid } from "../../domain/architecture-error.js";
import { makeFactExtractorLive } from "../../infrastructure/fact-extractor-live.js";
import { makeFileSystemLive } from "../../infrastructure/file-system-live.js";
import { makeModuleResolverLive } from "../../infrastructure/module-resolver-live.js";
import { type LoweredRules, lowerManifest } from "../../manifest/compile.js";
import { decodeManifest, type Manifest } from "../../manifest/manifest.js";
import type { FileSystem } from "../../ports/file-system.js";
import type { ModuleResolver } from "../../ports/module-resolver.js";

export type LoadedPolicy = {
  readonly repoRoot: string;
  readonly config: Manifest;
  readonly importRules: ReadonlyArray<CompiledImportRule>;
  readonly exportRules: ReadonlyArray<CompiledExportRule>;
  readonly memberRules: ReadonlyArray<CompiledMemberRule>;
  readonly surfaceRules: ReadonlyArray<CompiledSurfaceRule>;
  // Evaluated by the CLI only; compiled and probed here so a vacuous one fails
  // the plugin's load as well.
  readonly graph: CompiledGraph;
  readonly adoption: LoweredRules["adoption"];
  readonly structure: CompiledStructure;
  readonly fileSystem: FileSystem;
  // Violations this repository is carrying while it adopts the policy. Applied
  // at report time so a baselined finding costs nothing but a line in a file.
  readonly baseline: BaselineFilter;
  readonly resolver: ModuleResolver;
  readonly ignoreUnresolved: ReadonlyArray<RegExp>;
};

const readBaselineAt = (repoRoot: string, at: string) => {
  try {
    return decodeBaseline(JSON.parse(readFileSync(path.resolve(repoRoot, at), "utf8")) as unknown);
  } catch {
    // An absent or unreadable baseline carries nothing, which is the safe
    // direction: every violation reports.
    return EMPTY_BASELINE;
  }
};

export const DEFAULT_CONFIG_FILENAME = "architecture.config.mjs";

// Anything wrong with the policy — a missing file, a bad shape, an uncompilable
// pattern — must stop the lint run. A plugin that loads with an empty policy
// reports nothing and looks exactly like a clean codebase.
export const loadPolicy = async (
  repoRoot: string,
  configFilename: string = DEFAULT_CONFIG_FILENAME,
): Promise<LoadedPolicy> => {
  const configPath = path.resolve(repoRoot, configFilename);

  const module: unknown = await import(pathToFileURL(configPath).href).catch((cause: unknown) => {
    throw new ConfigInvalid({ configPath, detail: String(cause) });
  });

  const exported =
    typeof module === "object" && module !== null && "default" in module ? module.default : module;

  const decoded = decodeManifest(configPath, exported);
  if (Result.isFailure(decoded)) throw decoded.failure;
  const config = decoded.success;

  // The manifest is the authoring surface; these flat rules are the machine's.
  const rules = lowerManifest(config);

  // The ceilings. A tier that says "not tightened yet" is a sentence someone
  // wrote; a ceiling on how many may say so is what keeps the backlog from
  // becoming the architecture. Exceeding it is a policy that broke its own
  // promise, and is refused like any other invalid policy.
  const ceilings = [
    ["unrestricted", rules.adoption.unrestricted, config.limits?.unrestricted],
    ["partial", rules.adoption.partial, config.limits?.partial],
  ] as const;
  const exceeded = ceilings.flatMap(([label, nodes, ceiling]) =>
    ceiling !== undefined && nodes.length > ceiling
      ? [
          `${label}: ${String(nodes.length)} nodes against a ceiling of ${String(ceiling)} (${nodes.join(", ")})`,
        ]
      : [],
  );
  if (exceeded.length > 0) {
    throw new ConfigInvalid({
      configPath,
      detail:
        `the policy exceeds its own adoption ceiling — ${exceeded.join("; ")}. ` +
        `Tighten a tier, or raise the ceiling in \`limits\` on purpose.`,
    });
  }

  const importRules = compileImportRules(rules.imports);
  if (Result.isFailure(importRules)) throw importRules.failure;

  const exportRules = compileExportRules(rules.exports);
  if (Result.isFailure(exportRules)) throw exportRules.failure;

  const memberRules = compileMemberRules(rules.members);
  if (Result.isFailure(memberRules)) throw memberRules.failure;

  const surfaceRules = compileSurfaceRules(rules.surface);
  if (Result.isFailure(surfaceRules)) throw surfaceRules.failure;

  const graph = compileGraphRules(rules.graph);
  if (Result.isFailure(graph)) throw graph.failure;

  const structure = compileStructure(rules.structure);
  if (Result.isFailure(structure)) throw structure.failure;

  // A probe carrying a source snippet is parsed here, by the same extractor
  // the CLI reads every file through. The plugin reads through oxlint's tree
  // instead, and the parity suite is what holds that tree to this one.
  const extractor = makeFactExtractorLive();
  const vacuous = [
    ...rulesFailingTheirProbe(importRules.success),
    ...exportRulesFailingTheirProbe(exportRules.success, extractor),
    ...memberRulesFailingTheirProbe(memberRules.success, extractor),
    ...surfaceRulesFailingTheirProbe(surfaceRules.success, extractor),
  ]
    .map((rule) => rule.name)
    .concat(structureRulesFailingTheirProbe(structure.success))
    .concat(graphRulesFailingTheirProbe(graph.success));
  if (vacuous.length > 0) {
    throw new ConfigInvalid({
      configPath,
      detail:
        `these rules do not report their own probe, so they enforce nothing: ` +
        `${vacuous.join(", ")}. Fix the rule or its probe — ` +
        `a rule that cannot flag a violation it was written for is worse than no rule. ` +
        `A probe with a source snippet fails when the parser reads no site of that name ` +
        `out of it; \`architecture facts\` shows what the parser reads.`,
    });
  }

  return {
    repoRoot,
    config,
    importRules: importRules.success,
    exportRules: exportRules.success,
    memberRules: memberRules.success,
    surfaceRules: surfaceRules.success,
    graph: graph.success,
    adoption: rules.adoption,
    structure: structure.success,
    fileSystem: makeFileSystemLive(repoRoot),
    baseline: makeBaselineFilter(
      config.baseline === undefined ? EMPTY_BASELINE : readBaselineAt(repoRoot, config.baseline),
    ),
    resolver: makeModuleResolverLive(repoRoot, config.resolve),
    ignoreUnresolved: (config.resolve.ignoreUnresolved ?? []).map(
      (pattern: string) => new RegExp(pattern),
    ),
  };
};
