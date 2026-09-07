// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// Custom oxlint JS plugin: a per-test timeout may only raise the global.
// `bun run test` applies `--timeout 60000`, so `test("x", fn, 5000)` makes
// that test MORE likely to time out, not less (ARCH-005). Folds numeric
// constants declared in the same file, so `test("x", fn, BUDGET_MS * 5)`
// is judged by its value.

/**
 * The `--timeout` every `test*` script in package.json passes to `bun test`.
 * `tests/lint/no-lowered-test-timeout.test.ts` asserts the two agree.
 */
export const GLOBAL_TEST_TIMEOUT_MS = 60_000;

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

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Numeric constants declared with `const NAME = <foldable>` anywhere in the file. */
type Constants = ReadonlyMap<string, number>;

/**
 * Fold a numeric expression to its value.
 *
 * @returns The value, or undefined when any operand is not a numeric
 * literal, a folded constant, or a `+ - * /` combination of those.
 */
function foldNumber(
  node: AstNode | undefined,
  constants: Constants
): number | undefined {
  if (!node) return undefined;
  switch (node.type) {
    case "Literal": {
      return typeof node.value === "number" ? node.value : undefined;
    }
    case "Identifier": {
      return typeof node.name === "string"
        ? constants.get(node.name)
        : undefined;
    }
    case "UnaryExpression": {
      const operand = foldNumber(asNode(node.argument), constants);
      if (operand === undefined) return undefined;
      if (node.operator === "-") return -operand;
      return node.operator === "+" ? operand : undefined;
    }
    case "BinaryExpression": {
      const left = foldNumber(asNode(node.left), constants);
      const right = foldNumber(asNode(node.right), constants);
      if (left === undefined || right === undefined) return undefined;
      switch (node.operator) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return left / right;
        default:
          return undefined;
      }
    }
    default: {
      return undefined;
    }
  }
}

/** Depth-first walk over an AST subtree, skipping back-references and locations. */
function walk(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "loc" || key === "range") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        const child = asNode(item);
        if (child) walk(child, visit);
      }
    } else {
      const child = asNode(value);
      if (child) walk(child, visit);
    }
  }
}

/**
 * Collect every `const NAME = <expr>` whose initializer folds to a number.
 * Declarations are folded in source order, so a constant may refer to one
 * declared above it.
 */
function collectConstants(root: AstNode): Constants {
  const constants = new Map<string, number>();
  walk(root, (node) => {
    if (node.type !== "VariableDeclaration" || node.kind !== "const") return;
    for (const item of asArray(node.declarations)) {
      const declarator = asNode(item);
      const id = asNode(declarator?.id);
      if (id?.type !== "Identifier" || typeof id.name !== "string") continue;
      const value = foldNumber(asNode(declarator?.init), constants);
      if (value !== undefined) constants.set(id.name, value);
    }
  });
  return constants;
}

/** Resolve the leftmost identifier of `test`, `test.skip`, `test.skipIf(c)`, `test.each(rows)`. */
function leftmostName(node: AstNode | undefined): string | undefined {
  let current = node;
  while (current) {
    switch (current.type) {
      case "Identifier": {
        return typeof current.name === "string" ? current.name : undefined;
      }
      case "MemberExpression": {
        current = asNode(current.object);
        break;
      }
      case "CallExpression": {
        current = asNode(current.callee);
        break;
      }
      default: {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * The timeout a test call's third argument declares: either the bare number
 * or the `timeout` property of an options object.
 *
 * @returns The node carrying the value and its folded value, or undefined
 * when there is no third argument or it does not fold to a number.
 */
function declaredTimeout(
  call: AstNode,
  constants: Constants
): { node: AstNode; value: number } | undefined {
  const third = asNode(asArray(call.arguments)[2]);
  if (!third) return undefined;
  if (third.type === "ObjectExpression") {
    for (const item of asArray(third.properties)) {
      const property = asNode(item);
      const key = asNode(property?.key);
      if (
        property?.type !== "Property" ||
        property.computed === true ||
        key?.type !== "Identifier" ||
        key.name !== "timeout"
      ) {
        continue;
      }
      const valueNode = asNode(property.value);
      const value = foldNumber(valueNode, constants);
      return valueNode && value !== undefined
        ? { node: valueNode, value }
        : undefined;
    }
    return undefined;
  }
  const value = foldNumber(third, constants);
  return value === undefined ? undefined : { node: third, value };
}

interface ReportDescriptor {
  node: AstNode;
  message: string;
}

interface RuleContext {
  report(descriptor: ReportDescriptor): void;
}

function message(value: number): string {
  return `Per-test timeout ${value}ms is below the ${GLOBAL_TEST_TIMEOUT_MS}ms global that \`bun run test\` applies (package.json \`test\` scripts), so it only makes the test more likely to time out. Remove it, or set a value of at least ${GLOBAL_TEST_TIMEOUT_MS} (ARCH-005).`;
}

const noLoweredTestTimeout = {
  create(context: RuleContext) {
    return {
      Program(root: AstNode) {
        const constants = collectConstants(root);
        // The inner call of `test.skipIf(cond)(name, fn, timeout)` is the
        // callee of the outer one; only the outer call carries the timeout.
        const innerCalls = new Set<AstNode>();
        walk(root, (node) => {
          if (node.type !== "CallExpression") return;
          const callee = asNode(node.callee);
          if (callee?.type === "CallExpression") innerCalls.add(callee);
          if (innerCalls.has(node)) return;
          const base = leftmostName(callee);
          if (base !== "test" && base !== "it") return;
          const timeout = declaredTimeout(node, constants);
          if (timeout && timeout.value < GLOBAL_TEST_TIMEOUT_MS) {
            context.report({
              node: timeout.node,
              message: message(timeout.value),
            });
          }
        });
      },
    };
  },
};

const plugin = {
  meta: { name: "test-timeout" },
  rules: { "no-lowered-test-timeout": noLoweredTestTimeout },
};

export default plugin;
