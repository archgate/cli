// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// Custom oxlint JS plugin: tests stub first-party modules with `spyOn` over an
// `import * as mod` namespace, never `mock.module()` — which is process-global,
// retroactive, and not undone by `mock.restore()`, so one file's stub reaches
// files that never mention it (ARCH-005). Third-party specifiers are allowed:
// `inquirer` and `node:readline` have no namespace object to spy.

/** Minimal ESTree-ish node shape. The oxlint AST is ESLint-compatible. */
type AstNode = { type: string } & Record<string, unknown>;

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}

function asNode(value: unknown): AstNode | undefined {
  return isAstNode(value) ? value : undefined;
}

/**
 * The property name of a member expression, covering both `mock.module` and
 * the equivalent computed string form `mock["module"]`. A computed key that is
 * not a string literal stays undefined — its name is not knowable statically.
 */
function memberPropertyName(node: AstNode): string | undefined {
  const property = asNode(node.property);
  if (node.computed === true) {
    return property?.type === "Literal" && typeof property.value === "string"
      ? property.value
      : undefined;
  }
  if (property?.type === "Identifier" && typeof property.name === "string") {
    return property.name;
  }
  return undefined;
}

/** Whether `callee` is the `mock.module` member expression. */
function isMockModuleCallee(callee: AstNode | undefined): boolean {
  if (callee?.type !== "MemberExpression") return false;
  if (memberPropertyName(callee) !== "module") return false;
  const base = asNode(callee.object);
  return base?.type === "Identifier" && base.name === "mock";
}

/** The literal string value of a node, or undefined when it is not a plain string literal. */
function stringLiteralValue(node: AstNode | undefined): string | undefined {
  if (node?.type !== "Literal") return undefined;
  return typeof node.value === "string" ? node.value : undefined;
}

/**
 * Whether `specifier` names a module inside this repository's `src/` tree.
 *
 * Detection is lexical: a relative specifier carrying a `src` path segment.
 * `src/` is the only first-party source root, and no directory under `tests/`
 * is named `src`, so a `src` segment identifies first-party code without
 * resolving the path against the importing file's location.
 */
function isFirstPartySpecifier(specifier: string): boolean {
  if (!specifier.startsWith(".")) return false;
  return specifier.split("/").includes("src");
}

interface ReportDescriptor {
  node: AstNode;
  message: string;
}

interface RuleContext {
  report(descriptor: ReportDescriptor): void;
}

function message(specifier: string): string {
  return `Stub "${specifier}" with \`spyOn\` over an \`import * as mod\` namespace instead of \`mock.module()\`. \`mock.module()\` is process-global and retroactive, and \`mock.restore()\` does not undo it, so this stub reaches every other test file in the run (ARCH-005).`;
}

const noFirstPartyModuleMock = {
  create(context: RuleContext) {
    return {
      CallExpression(node: AstNode) {
        if (!isMockModuleCallee(asNode(node.callee))) return;
        const args = Array.isArray(node.arguments) ? node.arguments : [];
        const specifier = stringLiteralValue(asNode(args[0]));
        if (specifier === undefined) return;
        if (!isFirstPartySpecifier(specifier)) return;
        context.report({ node, message: message(specifier) });
      },
    };
  },
};

const plugin = {
  meta: { name: "test-mocking" },
  rules: { "no-first-party-module-mock": noFirstPartyModuleMock },
};

export default plugin;
