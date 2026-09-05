import type {
  Binding,
  DeclarationKind,
  ExportSite,
  FactExtractor,
  MemberSite,
  SourceFacts,
} from "@goodbones/core";
import ts from "typescript";

// The facts, read out of TypeScript's syntax tree. The plugin reads the same
// facts out of oxlint's; `src/adapters/parity.test.ts` holds the two to one
// answer, so a form added here without the matching visitor there fails a test
// rather than a user.

const scriptKindOf = (file: string): ts.ScriptKind =>
  file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

const nameOf = (node: ts.PropertyName | ts.ModuleExportName | undefined): string | null => {
  if (node === undefined) return null;
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node)) return node.text;
  return null;
};

const bindingsOfImportClause = (clause: ts.ImportClause | undefined): ReadonlyArray<Binding> => {
  if (clause === undefined) return [];
  const found: Array<Binding> = [];
  if (clause.name !== undefined) found.push({ symbol: "default", kind: "default" });
  const bindings = clause.namedBindings;
  if (bindings !== undefined) {
    if (ts.isNamespaceImport(bindings)) found.push({ symbol: "*", kind: "namespace" });
    else {
      for (const element of bindings.elements) {
        const symbol = nameOf(element.propertyName ?? element.name);
        if (symbol !== null) found.push({ symbol, kind: "named" });
      }
    }
  }
  return found;
};

// The whole module, as one binding. `export * from "m"`, `export * as ns from
// "m"`, `import x = require("m")`, `import("m")` and `require("m")` all carry
// every export of `m` at once, exactly as `import * as ns` does — and are the
// same way around a rule about a name. A side-effect import carries nothing.
const WHOLE_MODULE: ReadonlyArray<Binding> = [{ symbol: "*", kind: "namespace" }];

// `export { a } from "m"` — `propertyName` is the name in the source module when
// the export is renamed, so it is the one the policy is about.
const bindingsOfExportClause = (
  clause: ts.NamedExportBindings | undefined,
): ReadonlyArray<Binding> => {
  if (clause === undefined || ts.isNamespaceExport(clause)) return WHOLE_MODULE;
  const found: Array<Binding> = [];
  for (const element of clause.elements) {
    const symbol = nameOf(element.propertyName ?? element.name);
    if (symbol !== null) found.push({ symbol, kind: "named" });
  }
  return found;
};

// The type literals written in a type, through intersections, unions and
// parentheses: `type Port = Base & ({ a(): void } | { b(): void })` declares `a`
// and `b`. A reference is not followed — `Base`'s members are declared where
// `Base` is, and are reported there under its own name.
const literalsOf = (node: ts.TypeNode): ReadonlyArray<ts.TypeLiteralNode> => {
  if (ts.isTypeLiteralNode(node)) return [node];
  if (ts.isIntersectionTypeNode(node) || ts.isUnionTypeNode(node)) {
    return node.types.flatMap(literalsOf);
  }
  if (ts.isParenthesizedTypeNode(node)) return literalsOf(node.type);
  return [];
};

// The member shapes that carry a name a vocabulary rule can speak about: a
// property or method signature in a type, a property, method or accessor in a
// class. Mirrors the plugin's `DECLARED_MEMBER_TYPES`.
const isNamedMember = (
  member: ts.TypeElement | ts.ClassElement,
): member is (ts.TypeElement | ts.ClassElement) & { readonly name: ts.PropertyName } =>
  ts.isPropertySignature(member) ||
  ts.isMethodSignature(member) ||
  ts.isPropertyDeclaration(member) ||
  ts.isMethodDeclaration(member) ||
  ts.isGetAccessorDeclaration(member) ||
  ts.isSetAccessorDeclaration(member);

const calleeNameOf = (expression: ts.LeftHandSideExpression): string | null => {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) {
    return expression.name.text;
  }
  return null;
};

// The parse alone, for a source that need not be on disk — the CLI reads
// every file through it, a source probe is checked through it at load, and the
// parity suite feeds both adapters the same snippet through it.
export const factsOfText = (file: string, text: string): SourceFacts => {
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file));

  const specifiers: Array<string> = [];
  const bindings = new Map<string, Array<Binding>>();
  const memberSites: Array<MemberSite> = [];

  const record = (specifier: string, found: ReadonlyArray<Binding>): void => {
    if (!bindings.has(specifier)) {
      specifiers.push(specifier);
      bindings.set(specifier, []);
    }
    const existing = bindings.get(specifier);
    if (existing !== undefined) for (const binding of found) existing.push(binding);
  };

  // The members written in a declaration, under that declaration's name and
  // kind. A computed key is not a name a vocabulary rule can speak about;
  // neither is a private `#name`, an index, call or construct signature, or a
  // constructor.
  const declared = (
    declaration: string,
    declares: DeclarationKind,
    members: ReadonlyArray<ts.TypeElement | ts.ClassElement>,
  ): void => {
    for (const member of members) {
      if (!isNamedMember(member)) continue;
      if (ts.isComputedPropertyName(member.name) || ts.isPrivateIdentifier(member.name)) continue;
      const name = nameOf(member.name);
      if (name !== null) {
        memberSites.push({ file, subject: "members", name, in: declaration, declares });
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      // A side-effect import carries no bindings but is still an edge — the
      // `import "server-only"` form a regex cannot see.
      record(node.moduleSpecifier.text, bindingsOfImportClause(node.importClause));
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      record(node.moduleSpecifier.text, bindingsOfExportClause(node.exportClause));
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      record(node.moduleReference.expression.text, WHOLE_MODULE);
    } else if (ts.isCallExpression(node)) {
      const [first] = node.arguments;
      const isModuleCall =
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require");
      if (isModuleCall && first !== undefined && ts.isStringLiteral(first)) {
        record(first.text, WHOLE_MODULE);
      }

      const callee = calleeNameOf(node.expression);
      if (callee !== null) memberSites.push({ file, subject: "calls", name: callee });
    } else if (ts.isTypeAliasDeclaration(node)) {
      declared(
        node.name.text,
        "type",
        literalsOf(node.type).flatMap((literal) => literal.members),
      );
    } else if (ts.isInterfaceDeclaration(node)) {
      declared(node.name.text, "interface", node.members);
    } else if (ts.isClassDeclaration(node) && node.name !== undefined) {
      // A class body is a declaration with members like any other. An anonymous
      // class (`export default class {}`) has no name for `in` and is not read;
      // neither is a class expression, which is a value.
      declared(node.name.text, "class", node.members);
    }

    ts.forEachChild(node, visit);
  };

  visit(parsed);

  return { specifiers, bindings, memberSites, exportSites: exportSitesOf(file, parsed) };
};

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((one) => one.kind === kind);

// The names a declaration statement introduces, with what it declares them as.
// A destructuring pattern introduces names too, but not ones a surface rule
// judges by declaration kind; they read as `variable` like the rest.
const declaredNamesOf = (statement: ts.Node): ReadonlyArray<readonly [string, DeclarationKind]> => {
  if (ts.isFunctionDeclaration(statement)) {
    return statement.name === undefined ? [] : [[statement.name.text, "function"]];
  }
  if (ts.isClassDeclaration(statement)) {
    return statement.name === undefined ? [] : [[statement.name.text, "class"]];
  }
  if (ts.isVariableStatement(statement)) {
    const names: Array<readonly [string, DeclarationKind]> = [];
    const collect = (binding: ts.BindingName): void => {
      if (ts.isIdentifier(binding)) names.push([binding.text, "variable"]);
      else {
        for (const element of binding.elements) {
          if (ts.isBindingElement(element)) collect(element.name);
        }
      }
    };
    for (const declaration of statement.declarationList.declarations) collect(declaration.name);
    return names;
  }
  if (ts.isTypeAliasDeclaration(statement)) return [[statement.name.text, "type"]];
  if (ts.isInterfaceDeclaration(statement)) return [[statement.name.text, "interface"]];
  if (ts.isEnumDeclaration(statement)) return [[statement.name.text, "enum"]];
  if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) {
    return [[statement.name.text, "other"]];
  }
  return [];
};

// A file's surface: what its top-level statements export, in source order. An
// `export` inside a namespace body is that namespace's, not the module's.
const exportSitesOf = (file: string, parsed: ts.SourceFile): ReadonlyArray<ExportSite> => {
  const locals = new Map<string, DeclarationKind>();
  for (const statement of parsed.statements) {
    for (const [name, declares] of declaredNamesOf(statement)) locals.set(name, declares);
  }

  const sites: Array<ExportSite> = [];
  const site = (
    name: string,
    kind: ExportSite["kind"],
    declares: DeclarationKind,
    reexport: boolean,
  ): void => {
    sites.push({ file, name, kind, declares, reexport });
  };

  for (const statement of parsed.statements) {
    if (ts.isExportDeclaration(statement)) {
      const reexport = statement.moduleSpecifier !== undefined;
      const clause = statement.exportClause;
      if (clause === undefined) site("*", "namespace", "other", true);
      else if (ts.isNamespaceExport(clause)) site(clause.name.text, "namespace", "other", true);
      else {
        for (const element of clause.elements) {
          const name = nameOf(element.name);
          if (name === null) continue;
          const local = nameOf(element.propertyName ?? element.name) ?? name;
          const declares = reexport ? "other" : (locals.get(local) ?? "other");
          site(name, name === "default" ? "default" : "named", declares, reexport);
        }
      }
    } else if (ts.isExportAssignment(statement)) {
      // `export = x` is a CommonJS surface, not a module's.
      if (statement.isExportEquals === true) continue;
      const declares = ts.isIdentifier(statement.expression)
        ? (locals.get(statement.expression.text) ?? "expression")
        : "expression";
      site("default", "default", declares, false);
    } else if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
      const declared = declaredNamesOf(statement);
      if (isDefault) {
        // `export default function () {}` has no name to look up.
        const declares =
          declared[0]?.[1] ??
          (ts.isFunctionDeclaration(statement)
            ? "function"
            : ts.isClassDeclaration(statement)
              ? "class"
              : "other");
        site("default", "default", declares, false);
      } else {
        for (const [name, declares] of declared) site(name, "named", declares, false);
      }
    }
  }
  return sites;
};

export const makeFactExtractorLive = (): FactExtractor => ({ factsOf: factsOfText });
