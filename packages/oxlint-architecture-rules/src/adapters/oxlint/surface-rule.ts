import {
  type CompiledSurfaceRule,
  evaluateSurface,
  type ExportSite,
  surfaceRulesSelecting,
} from "../../core/surface.js";
import type { DeclarationKind } from "../../domain/architecture-config.js";
import { formatMessage } from "../../domain/violation.js";
import type { LoadedPolicy } from "./config-loader.js";
import {
  type OxlintRule,
  type ReportableNode,
  type RuleContext,
  toRepoRelative,
} from "./oxlint-api.js";

type NamedNode = ReportableNode & {
  readonly type?: string;
  readonly name?: unknown;
  readonly value?: unknown;
};

// A top-level statement, as far as this rule reads one. Every field is
// optional because the visitor takes the whole `Node` union; each is checked
// before use.
type StatementNode = ReportableNode & {
  readonly type: string;
  readonly id?: NamedNode | null;
  readonly declaration?: StatementNode | null;
  readonly declarations?: ReadonlyArray<{ readonly id?: PatternNode | null }> | null;
  readonly specifiers?: ReadonlyArray<SpecifierNode> | null;
  readonly source?: { readonly value?: unknown } | null;
  readonly exported?: NamedNode | null;
};

type PatternNode = ReportableNode & {
  readonly type: string;
  readonly name?: unknown;
  readonly properties?: ReadonlyArray<{
    readonly value?: PatternNode | null;
    readonly argument?: PatternNode | null;
  }> | null;
  readonly elements?: ReadonlyArray<PatternNode | null> | null;
  readonly left?: PatternNode | null;
  readonly argument?: PatternNode | null;
};

type SpecifierNode = ReportableNode & {
  readonly exported?: NamedNode | null;
  readonly local?: NamedNode | null;
};

type ProgramNode = ReportableNode & { readonly body?: unknown };

const isStatementList = (value: unknown): value is ReadonlyArray<StatementNode> =>
  Array.isArray(value);

const nameOf = (node: NamedNode | null | undefined): string | null => {
  if (node === null || node === undefined) return null;
  if (typeof node.name === "string") return node.name;
  return typeof node.value === "string" ? node.value : null;
};

// The identifiers a binding pattern introduces.
const patternNames = (pattern: PatternNode | null | undefined): ReadonlyArray<string> => {
  if (pattern === null || pattern === undefined) return [];
  switch (pattern.type) {
    case "Identifier":
      return typeof pattern.name === "string" ? [pattern.name] : [];
    case "ObjectPattern":
      return (pattern.properties ?? []).flatMap((property) =>
        patternNames(property.value ?? property.argument),
      );
    case "ArrayPattern":
      return (pattern.elements ?? []).flatMap(patternNames);
    case "AssignmentPattern":
      return patternNames(pattern.left);
    case "RestElement":
      return patternNames(pattern.argument);
    default:
      return [];
  }
};

// The names a declaration statement introduces, with what it declares them as.
const declaredNamesOf = (
  statement: StatementNode,
): ReadonlyArray<readonly [string, DeclarationKind]> => {
  const named = (declares: DeclarationKind): ReadonlyArray<readonly [string, DeclarationKind]> => {
    const name = nameOf(statement.id);
    return name === null ? [] : [[name, declares]];
  };
  switch (statement.type) {
    case "FunctionDeclaration":
      return named("function");
    case "ClassDeclaration":
      return named("class");
    case "VariableDeclaration":
      return (statement.declarations ?? []).flatMap((declaration) =>
        patternNames(declaration.id).map((name) => [name, "variable"] as const),
      );
    case "TSTypeAliasDeclaration":
      return named("type");
    case "TSInterfaceDeclaration":
      return named("interface");
    case "TSEnumDeclaration":
      return named("enum");
    case "TSModuleDeclaration":
      return named("other");
    default:
      return [];
  }
};

type Found = { readonly site: ExportSite; readonly node: ReportableNode };

// A file's surface, read off the program body rather than by visiting export
// nodes: an `export` inside a namespace body is that namespace's, not the
// module's, and reading the top level directly is what says so without a
// parent pointer. Mirrors the CLI's `exportSitesOf`.
const surfaceOf = (file: string, body: ReadonlyArray<StatementNode>): ReadonlyArray<Found> => {
  const locals = new Map<string, DeclarationKind>();
  for (const statement of body) {
    const declaration =
      statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration"
        ? statement.declaration
        : statement;
    if (declaration === null || declaration === undefined) continue;
    for (const [name, declares] of declaredNamesOf(declaration)) locals.set(name, declares);
  }

  const found: Array<Found> = [];
  const site = (
    node: ReportableNode,
    name: string,
    kind: ExportSite["kind"],
    declares: DeclarationKind,
    reexport: boolean,
  ): void => {
    found.push({ node, site: { file, name, kind, declares, reexport } });
  };

  for (const statement of body) {
    switch (statement.type) {
      case "ExportNamedDeclaration": {
        const declaration = statement.declaration;
        if (declaration !== null && declaration !== undefined) {
          for (const [name, declares] of declaredNamesOf(declaration)) {
            site(declaration, name, "named", declares, false);
          }
          break;
        }
        const reexport = typeof statement.source?.value === "string";
        for (const specifier of statement.specifiers ?? []) {
          const name = nameOf(specifier.exported);
          if (name === null) continue;
          const local = nameOf(specifier.local) ?? name;
          const declares = reexport ? "other" : (locals.get(local) ?? "other");
          site(specifier, name, name === "default" ? "default" : "named", declares, reexport);
        }
        break;
      }
      case "ExportDefaultDeclaration": {
        const declaration = statement.declaration;
        const declares: DeclarationKind =
          declaration === null || declaration === undefined
            ? "expression"
            : declaration.type === "FunctionDeclaration"
              ? "function"
              : declaration.type === "ClassDeclaration"
                ? "class"
                : declaration.type === "TSInterfaceDeclaration"
                  ? "interface"
                  : declaration.type === "Identifier"
                    ? (locals.get(nameOf(declaration) ?? "") ?? "expression")
                    : "expression";
        site(statement, "default", "default", declares, false);
        break;
      }
      case "ExportAllDeclaration":
        site(statement, nameOf(statement.exported) ?? "*", "namespace", "other", true);
        break;
      default:
        break;
    }
  }
  return found;
};

export const makeSurfaceRule = (policy: LoadedPolicy): OxlintRule => ({
  meta: {
    type: "problem" as const,
    docs: {
      description:
        "what a file may export — no default exports, a barrel that only re-exports, a handler that exports one function",
    },
    schema: [],
  },

  createOnce(context: RuleContext) {
    let file = "";
    let selected: ReadonlyArray<CompiledSurfaceRule> = [];

    return {
      before() {
        file = toRepoRelative(policy.repoRoot, context.filename);
        if (file.startsWith("..")) return false;
        selected = surfaceRulesSelecting(policy.surfaceRules, file);
        return selected.length > 0;
      },

      Program(node: ProgramNode) {
        if (!isStatementList(node.body)) return;
        const found = surfaceOf(file, node.body);
        const violations = evaluateSurface(
          selected,
          file,
          found.map((one) => one.site),
        );

        // A per-site violation lands on the site's own node; a `count` one, on
        // the program — it is about the file.
        const used = new Set<Found>();
        for (const violation of violations) {
          if (policy.baseline.isBaselined(violation)) continue;
          const at =
            violation.subject === null
              ? undefined
              : found.find((one) => one.site.name === violation.subject && !used.has(one));
          if (at !== undefined) used.add(at);
          context.report({ node: at?.node ?? node, message: formatMessage(violation) });
        }
      },
    };
  },
});
