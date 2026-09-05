import {
  evaluateSelectedEdge,
  formatMessage,
  type LoadedPolicy,
  rulesSelecting,
  type SelectedRule,
} from "@goodbones/core";
import * as Result from "effect/Result";

import {
  type CallNode,
  type ImportEqualsNode,
  importEqualsSpecifierOf,
  type ImportExpressionNode,
  importExpressionSpecifierOf,
  type OxlintRule,
  type ReportableNode,
  requireSpecifierOf,
  type RuleContext,
  type SourceNode,
  specifierOf,
  toRepoRelative,
} from "./oxlint-api.js";

const unresolvedMessage = (specifier: string, detail: string): string =>
  `[unresolved-import] "${specifier}" could not be resolved, so every import rule about it ` +
  `enforces nothing. Fix the resolve scope in the architecture config, or list the specifier ` +
  `in resolve.ignoreUnresolved. (${detail})`;

export const makeImportsRule = (policy: LoadedPolicy): OxlintRule => ({
  meta: {
    type: "problem" as const,
    docs: {
      description:
        "import boundaries between folders and packages, matched against fully resolved module paths",
    },
    schema: [],
  },

  // `createOnce` is what makes resolution affordable: the resolver and the
  // compiled rules are built once per lint run, and `before` decides per file
  // whether any rule selects it at all — a file none select is skipped whole.
  createOnce(context: RuleContext) {
    let importer = "";
    let selected: ReadonlyArray<SelectedRule> = [];

    const check = (node: ReportableNode, specifier: string | null): void => {
      if (specifier === null) return;

      const outcome = evaluateSelectedEdge(selected, policy.resolver, { importer, specifier });

      if (Result.isFailure(outcome)) {
        if (policy.config.resolve.unresolved === "off") return;
        if (policy.ignoreUnresolved.some((pattern) => pattern.test(specifier))) return;
        context.report({ node, message: unresolvedMessage(specifier, outcome.failure.detail) });
        return;
      }

      for (const violation of outcome.success) {
        if (policy.baseline.isBaselined(violation)) continue;
        context.report({ node, message: formatMessage(violation) });
      }
    };

    const checkSource = (node: SourceNode): void => {
      check(node, specifierOf(node));
    };

    // Every form that names a module is an edge. The CLI adapter reads the same
    // five out of TypeScript's tree, and the parity suite holds the two to it: a
    // `require` the plugin skipped would be a rule that enforces nothing under
    // `oxlint` while failing under `architecture check`.
    return {
      before() {
        importer = toRepoRelative(policy.repoRoot, context.filename);
        if (importer.startsWith("..")) return false;
        selected = rulesSelecting(policy.importRules, importer);
        return selected.length > 0;
      },
      ImportDeclaration: checkSource,
      ExportNamedDeclaration: checkSource,
      ExportAllDeclaration: checkSource,
      // `import("m")` with a literal argument. A computed one is not a fact a
      // static policy can speak about, in either adapter.
      ImportExpression(node: ImportExpressionNode) {
        check(node, importExpressionSpecifierOf(node));
      },
      CallExpression(node: CallNode) {
        check(node, requireSpecifierOf(node));
      },
      TSImportEqualsDeclaration(node: ImportEqualsNode) {
        check(node, importEqualsSpecifierOf(node));
      },
    };
  },
});
