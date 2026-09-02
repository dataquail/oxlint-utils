import * as Result from "effect/Result";

import { evaluateSelectedEdge, rulesSelecting, type SelectedRule } from "../../core/imports.js";
import { formatMessage } from "../../domain/violation.js";
import type { LoadedPolicy } from "./config-loader.js";
import {
  type OxlintRule,
  type ReportableNode,
  type RuleContext,
  type SourceNode,
  specifierOf,
  toRepoRelative,
} from "./oxlint-api.js";

// `require("m")` — a CallExpression whose callee is the bare identifier.
type CallNode = ReportableNode & {
  readonly callee?: { readonly type: string; readonly name?: unknown } | null;
  readonly arguments?: ReadonlyArray<{ readonly type: string; readonly value?: unknown }> | null;
};

// `import("m")` — `source` is any expression; only a string literal is an edge.
type ImportExpressionNode = ReportableNode & {
  readonly source?: { readonly type?: string; readonly value?: unknown } | null;
};

// `import x = require("m")` — the module is under `moduleReference`, not `source`.
type ImportEqualsNode = ReportableNode & {
  readonly moduleReference?: {
    readonly type: string;
    readonly expression?: { readonly value?: unknown } | null;
  } | null;
};

const requireSpecifierOf = (node: CallNode): string | null => {
  if (node.callee?.type !== "Identifier" || node.callee.name !== "require") return null;
  const [first] = node.arguments ?? [];
  return first?.type === "Literal" && typeof first.value === "string" ? first.value : null;
};

const importExpressionSpecifierOf = (node: ImportExpressionNode): string | null => {
  const source = node.source;
  return source?.type === "Literal" && typeof source.value === "string" ? source.value : null;
};

const importEqualsSpecifierOf = (node: ImportEqualsNode): string | null => {
  const reference = node.moduleReference;
  if (reference?.type !== "TSExternalModuleReference") return null;
  const value = reference.expression?.value;
  return typeof value === "string" ? value : null;
};

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
