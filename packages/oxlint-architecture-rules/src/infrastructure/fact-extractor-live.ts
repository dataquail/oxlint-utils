import ts from "typescript";

import type { Binding, MemberSite, SourceFacts } from "../domain/facts.js";
import type { FactExtractor } from "../ports/fact-extractor.js";

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

  // The members written in a declaration, under that declaration's name. A
  // computed key is not a name a vocabulary rule can speak about; neither is an
  // index, call or construct signature.
  const declared = (declaration: string, members: ReadonlyArray<ts.TypeElement>): void => {
    for (const member of members) {
      if (!ts.isPropertySignature(member) && !ts.isMethodSignature(member)) continue;
      if (ts.isComputedPropertyName(member.name)) continue;
      const name = nameOf(member.name);
      if (name !== null) {
        memberSites.push({ file, subject: "type-members", name, in: declaration });
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
        literalsOf(node.type).flatMap((literal) => literal.members),
      );
    } else if (ts.isInterfaceDeclaration(node)) {
      declared(node.name.text, node.members);
    }

    ts.forEachChild(node, visit);
  };

  visit(parsed);

  return { specifiers, bindings, memberSites };
};

export const makeFactExtractorLive = (): FactExtractor => ({ factsOf: factsOfText });
