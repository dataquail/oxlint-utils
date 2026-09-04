import {
  type CompiledMemberRule,
  type DeclarationKind,
  evaluateMemberSite,
  formatMessage,
  type LoadedPolicy,
  memberRulesSelecting,
} from "@goodbones/core";

import {
  type OxlintRule,
  type ReportableNode,
  type RuleContext,
  toRepoRelative,
} from "./oxlint-api.js";

type NamedNode = ReportableNode & {
  readonly type: string;
  readonly name?: unknown;
  readonly value?: unknown;
};

type MemberNode = ReportableNode & {
  readonly type: string;
  readonly key?: (NamedNode & { readonly type?: string }) | null;
  readonly computed?: boolean;
  // A class method's kind: `method`, `get`, `set` or `constructor`.
  readonly kind?: string;
};

// A type, as far as this rule reads it: a literal with members, or an
// intersection / union / parenthesised type wrapping others.
type TypeNode = ReportableNode & {
  readonly type: string;
  readonly members?: ReadonlyArray<MemberNode>;
  readonly types?: ReadonlyArray<TypeNode>;
  readonly typeAnnotation?: TypeNode | null;
};

type TypeAliasNode = ReportableNode & {
  readonly id?: NamedNode | null;
  readonly typeAnnotation?: TypeNode | null;
};

// Every visitor takes the whole `Node` union, so `body` is typed to admit a
// function body as readily as an interface's, and narrowed below.
type InterfaceNode = ReportableNode & {
  readonly id?: NamedNode | null;
  readonly body?: { readonly type?: string; readonly body?: unknown } | null;
};

type ClassNode = InterfaceNode;

const isMemberList = (value: unknown): value is ReadonlyArray<MemberNode> => Array.isArray(value);

type CallNode = ReportableNode & {
  readonly callee?:
    | (ReportableNode & {
        readonly type: string;
        readonly name?: unknown;
        readonly computed?: boolean;
        readonly property?: (NamedNode & { readonly type: string }) | null;
      })
    | null;
};

// The member shapes that carry a name a vocabulary rule can speak about: a
// property or method signature in a type, a property, method or accessor in a
// class. Mirrors the CLI's `isNamedMember`.
const DECLARED_MEMBER_TYPES = new Set([
  "TSPropertySignature",
  "TSMethodSignature",
  "PropertyDefinition",
  "MethodDefinition",
  "TSAbstractPropertyDefinition",
  "TSAbstractMethodDefinition",
]);

// The type literals written in a type, through intersections, unions and
// parentheses. A reference is not followed: its members are declared where it
// is, and reported there under its own name. Mirrors the CLI's `literalsOf`.
const literalsOf = (node: TypeNode | null | undefined): ReadonlyArray<TypeNode> => {
  if (node === null || node === undefined) return [];
  switch (node.type) {
    case "TSTypeLiteral":
      return [node];
    case "TSIntersectionType":
    case "TSUnionType":
      return (node.types ?? []).flatMap(literalsOf);
    case "TSParenthesizedType":
      return literalsOf(node.typeAnnotation);
    default:
      return [];
  }
};

const nameOf = (node: NamedNode | null | undefined): string | null => {
  if (node === null || node === undefined) return null;
  if (typeof node.name === "string") return node.name;
  return typeof node.value === "string" ? node.value : null;
};

// The name a call is made by: `f()` and `x.f()` are both `f`. `x[f]()` and
// `x["f"]()` are not — a computed property is not a name a vocabulary rule can
// speak about — and neither is a private `x.#f()`. The CLI reads the same
// three cases out of TypeScript's tree; the parity suite keeps them agreeing.
const calleeName = (node: CallNode): string | null => {
  const callee = node.callee;
  if (callee === null || callee === undefined) return null;
  if (callee.type === "Identifier" && typeof callee.name === "string") return callee.name;
  if (callee.type !== "MemberExpression" || callee.computed === true) return null;
  const property = callee.property;
  if (property?.type !== "Identifier") return null;
  return nameOf(property);
};

export const makeMembersRule = (policy: LoadedPolicy): OxlintRule => ({
  meta: {
    type: "problem" as const,
    docs: {
      description:
        "which names a file may declare or call — a port's method vocabulary, a tier's allowed hooks",
    },
    schema: [],
  },

  createOnce(context: RuleContext) {
    let file = "";
    let selected: ReadonlyArray<CompiledMemberRule> = [];

    const report = (
      node: ReportableNode,
      name: string,
      declaration?: { readonly name: string; readonly declares: DeclarationKind },
    ): void => {
      const violations = evaluateMemberSite(selected, {
        file,
        subject: declaration === undefined ? "calls" : "members",
        name,
        ...(declaration === undefined
          ? {}
          : { in: declaration.name, declares: declaration.declares }),
      });
      for (const violation of violations) {
        if (policy.baseline.isBaselined(violation)) continue;
        context.report({ node, message: formatMessage(violation) });
      }
    };

    // The members written in a declaration, under that declaration's name and
    // kind. A computed key is not a name a vocabulary rule can speak about;
    // neither is a private `#name`, an index, call or construct signature, or
    // a constructor.
    const declared = (
      declaration: string,
      declares: DeclarationKind,
      members: ReadonlyArray<MemberNode>,
    ): void => {
      for (const member of members) {
        if (member.computed === true || !DECLARED_MEMBER_TYPES.has(member.type)) continue;
        if (member.key?.type === "PrivateIdentifier" || member.kind === "constructor") continue;
        const name = nameOf(member.key);
        if (name !== null) report(member.key ?? member, name, { name: declaration, declares });
      }
    };

    return {
      before() {
        file = toRepoRelative(policy.repoRoot, context.filename);
        if (file.startsWith("..")) return false;
        selected = memberRulesSelecting(policy.memberRules, file);
        return selected.length > 0;
      },

      TSTypeAliasDeclaration(node: TypeAliasNode) {
        const declaration = nameOf(node.id);
        if (declaration === null) return;
        for (const literal of literalsOf(node.typeAnnotation)) {
          declared(declaration, "type", literal.members ?? []);
        }
      },

      TSInterfaceDeclaration(node: InterfaceNode) {
        const declaration = nameOf(node.id);
        const members = node.body?.body;
        if (declaration === null || !isMemberList(members)) return;
        declared(declaration, "interface", members);
      },

      // A named class only, as the CLI reads it: an anonymous default class has
      // no name for `in`, and a class expression is a value.
      ClassDeclaration(node: ClassNode) {
        const declaration = nameOf(node.id);
        const members = node.body?.body;
        if (declaration === null || !isMemberList(members)) return;
        declared(declaration, "class", members);
      },

      CallExpression(node: CallNode) {
        const name = calleeName(node);
        if (name !== null) report(node, name);
      },
    };
  },
});
