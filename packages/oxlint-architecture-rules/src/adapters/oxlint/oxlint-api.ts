import * as path from "node:path";

import type { RuleTester } from "oxlint/plugins-dev";

// oxlint publishes no plugin types, so the exact `Context`, node and fixer shapes
// are recovered from `RuleTester`'s own signature — the one public surface that
// names them. Hand-rolling them drifts silently against an alpha API.
export type OxlintRule = Parameters<RuleTester["run"]>[1];
export type RuleContext = Parameters<Extract<OxlintRule, { createOnce: unknown }>["createOnce"]>[0];

type Diagnostic = Parameters<RuleContext["report"]>[0];
export type ReportableNode = Extract<Diagnostic, { node: unknown }>["node"];
export type Fixer = Parameters<NonNullable<Diagnostic["fix"]>>[0];

export type SourceNode = ReportableNode & {
  readonly source?: { readonly value?: unknown } | null;
};

export const toRepoRelative = (repoRoot: string, filename: string): string =>
  path.relative(repoRoot, filename).replaceAll(path.sep, "/");

export const specifierOf = (node: SourceNode): string | null => {
  const value = node.source?.value;
  return typeof value === "string" ? value : null;
};

// The three forms that name a module without an `import … from`. Each is an
// edge for the import rule and a whole-module binding for the export rule, so
// both read them through these.

// `require("m")` — a CallExpression whose callee is the bare identifier.
export type CallNode = ReportableNode & {
  readonly callee?: { readonly type: string; readonly name?: unknown } | null;
  readonly arguments?: ReadonlyArray<{ readonly type: string; readonly value?: unknown }> | null;
};

// `import("m")` — `source` is any expression; only a string literal is an edge.
export type ImportExpressionNode = ReportableNode & {
  readonly source?: { readonly type?: string; readonly value?: unknown } | null;
};

// `import x = require("m")` — the module is under `moduleReference`, not `source`.
export type ImportEqualsNode = ReportableNode & {
  readonly moduleReference?: {
    readonly type: string;
    readonly expression?: { readonly value?: unknown } | null;
  } | null;
};

export const requireSpecifierOf = (node: CallNode): string | null => {
  if (node.callee?.type !== "Identifier" || node.callee.name !== "require") return null;
  const [first] = node.arguments ?? [];
  return first?.type === "Literal" && typeof first.value === "string" ? first.value : null;
};

export const importExpressionSpecifierOf = (node: ImportExpressionNode): string | null => {
  const source = node.source;
  return source?.type === "Literal" && typeof source.value === "string" ? source.value : null;
};

export const importEqualsSpecifierOf = (node: ImportEqualsNode): string | null => {
  const reference = node.moduleReference;
  if (reference?.type !== "TSExternalModuleReference") return null;
  const value = reference.expression?.value;
  return typeof value === "string" ? value : null;
};
