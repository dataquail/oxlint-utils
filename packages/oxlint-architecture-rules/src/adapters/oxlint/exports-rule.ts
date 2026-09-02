import * as Result from "effect/Result";

import {
  type Binding,
  evaluateSelectedBindings,
  exportRulesSelecting,
  type SelectedExportRule,
} from "../../core/exports.js";
import { formatMessage } from "../../domain/violation.js";
import type { LoadedPolicy } from "./config-loader.js";
import {
  type CallNode,
  type Fixer,
  type ImportEqualsNode,
  importEqualsSpecifierOf,
  type ImportExpressionNode,
  importExpressionSpecifierOf,
  type OxlintRule,
  type ReportableNode,
  requireSpecifierOf,
  type RuleContext,
  toRepoRelative,
} from "./oxlint-api.js";

type NamedNode = ReportableNode & { readonly name?: unknown; readonly value?: unknown };

type SpecifierNode = ReportableNode & {
  readonly type: string;
  readonly imported?: NamedNode | null;
  readonly local?: NamedNode | null;
};

type DeclarationNode = ReportableNode & {
  readonly source?: { readonly value?: unknown } | null;
  readonly specifiers?: ReadonlyArray<SpecifierNode> | null;
};

const nameOf = (node: NamedNode | null | undefined): string | null => {
  if (node === null || node === undefined) return null;
  if (typeof node.name === "string") return node.name;
  // `import { "a-b" as ab }` — a string-literal export name.
  return typeof node.value === "string" ? node.value : null;
};

type Bound = Binding & { readonly node: ReportableNode; readonly local: string };

// The whole module, as one binding. `export * from "m"`, `export * as ns from
// "m"`, `import x = require("m")`, `import("m")` and `require("m")` all carry
// every export of `m` at once, exactly as `import * as ns` does — and are the
// same way around a rule about a name. A side-effect import carries nothing.
const wholeModule = (node: ReportableNode, local = ""): Bound => ({
  symbol: "*",
  kind: "namespace",
  node,
  local,
});

type ExportAllNode = DeclarationNode & { readonly exported?: NamedNode | null };

const boundOf = (specifier: SpecifierNode): Bound | null => {
  const local = nameOf(specifier.local) ?? "";
  switch (specifier.type) {
    case "ImportSpecifier": {
      const symbol = nameOf(specifier.imported);
      return symbol === null ? null : { symbol, kind: "named", node: specifier, local };
    }
    case "ImportDefaultSpecifier":
      return { symbol: "default", kind: "default", node: specifier, local };
    case "ImportNamespaceSpecifier":
      return { symbol: "*", kind: "namespace", node: specifier, local };
    // `export { a } from "…"` — `local` is the name in the source module.
    case "ExportSpecifier": {
      const symbol = nameOf(specifier.local);
      return symbol === null ? null : { symbol, kind: "named", node: specifier, local: symbol };
    }
    default:
      return null;
  }
};

const specifierOf = (node: DeclarationNode): string | null => {
  const value = node.source?.value;
  return typeof value === "string" ? value : null;
};

const boundSpecifiers = (node: DeclarationNode): ReadonlyArray<Bound> =>
  (node.specifiers ?? []).map(boundOf).filter((one): one is Bound => one !== null);

// `import { A, B as C } from "pkg"` becomes `import * as A from "pkg/A"` and
// `import * as C from "pkg/B"`. Only whole-declaration rewrites are offered: a
// declaration mixing restricted named imports with a default or namespace one
// would need comma surgery inside the braces, and a fix that is subtly wrong is
// worse than a diagnostic the author resolves by hand.
const subpathNamespaceImport = (specifier: string, bound: ReadonlyArray<Bound>): string =>
  bound
    .map((binding) => `import * as ${binding.local} from "${specifier}/${binding.symbol}";`)
    .join("\n");

export const makeExportsRule = (policy: LoadedPolicy): OxlintRule => ({
  meta: {
    type: "problem" as const,
    fixable: "code" as const,
    docs: {
      description:
        "which exported symbols a file may import, for rules a path alone cannot express",
    },
    schema: [],
  },

  createOnce(context: RuleContext) {
    let importer = "";
    let selected: ReadonlyArray<SelectedExportRule> = [];

    // `fixable` is whether a rewrite could apply: only an `import` declaration
    // can be rewritten into subpath namespace imports. `export *` and the
    // whole-module forms are reported and left for the author.
    const check = (
      node: ReportableNode,
      specifierValue: string | null,
      bound: ReadonlyArray<Bound>,
      fixable: boolean,
    ): void => {
      if (specifierValue === null || bound.length === 0) return;

      const outcome = evaluateSelectedBindings(selected, policy.resolver, {
        importer,
        specifier: specifierValue,
        bindings: bound,
      });

      if (Result.isFailure(outcome)) {
        // `architecture/imports` reports the same unresolved edge, so staying
        // quiet here avoids two diagnostics for one broken specifier.
        return;
      }

      for (const { bindings, rule, violation } of outcome.success) {
        if (policy.baseline.isBaselined(violation)) continue;
        const offending = bound.filter((one: Bound) =>
          bindings.some((binding) => binding.symbol === one.symbol && binding.kind === one.kind),
        );
        // The rewrite is `import * as X from "pkg/<name>"`, which only means
        // something for a named binding — a namespace one has no name to put
        // in the subpath.
        const rewritable =
          fixable &&
          rule.fix === "subpath-namespace-import" &&
          offending.length === bound.length &&
          offending.every((one) => one.kind === "named");

        if (rewritable) {
          context.report({
            node,
            message: formatMessage(violation),
            fix: (fixer: Fixer) =>
              fixer.replaceText(node, subpathNamespaceImport(specifierValue, offending)),
          });
          continue;
        }

        context.report({
          node: offending[0]?.node ?? node,
          message: formatMessage(violation),
        });
      }
    };

    return {
      before() {
        importer = toRepoRelative(policy.repoRoot, context.filename);
        if (importer.startsWith("..")) return false;
        selected = exportRulesSelecting(policy.exportRules, importer);
        return selected.length > 0;
      },
      ImportDeclaration(node: DeclarationNode) {
        check(node, specifierOf(node), boundSpecifiers(node), true);
      },
      ExportNamedDeclaration(node: DeclarationNode) {
        check(node, specifierOf(node), boundSpecifiers(node), false);
      },
      ExportAllDeclaration(node: ExportAllNode) {
        check(node, specifierOf(node), [wholeModule(node, nameOf(node.exported) ?? "")], false);
      },
      ImportExpression(node: ImportExpressionNode) {
        check(node, importExpressionSpecifierOf(node), [wholeModule(node)], false);
      },
      CallExpression(node: CallNode) {
        check(node, requireSpecifierOf(node), [wholeModule(node)], false);
      },
      TSImportEqualsDeclaration(node: ImportEqualsNode) {
        check(node, importEqualsSpecifierOf(node), [wholeModule(node)], false);
      },
    };
  },
});
