// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// Custom oxlint JS plugin: every runnable bun:test test/it call must contain
// at least one `expect()` assertion. Reimplements `jest/expect-expect` for
// bun:test — the built-in Rust rule only recognizes jest/vitest imports.
// Runs natively as TypeScript under Bun (no build step); JS plugins API:
// https://oxc.rs/docs/guide/usage/linter/js-plugins.html

/** Minimal ESTree-ish node shape. The oxlint AST is ESLint-compatible. */
type AstNode = { type: string } & Record<string, unknown>;

/**
 * True narrowing predicate for an AST node (an object with a string `type`).
 * Uses `in` narrowing rather than a `typeof value === "object"` check alone
 * plus an `as AstNode` cast — the same pattern the `.rules.ts` type guards
 * use, so this never claims node-ness for an arbitrary object (e.g. a `.loc`
 * position record) that merely happens to be non-null.
 */
function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}

/** Narrow an unknown value to an AST node, or `undefined` if it isn't one. */
function asNode(value: unknown): AstNode | undefined {
  return isAstNode(value) ? value : undefined;
}

/** True when the node is a function expression that can serve as a test body. */
function isFunctionNode(node: AstNode | undefined): boolean {
  return (
    node?.type === "ArrowFunctionExpression" ||
    node?.type === "FunctionExpression"
  );
}

/**
 * Resolve the leftmost identifier name of a callee chain.
 * Examples: `test` -> "test"; `test.skip` -> "test";
 * `test.skipIf(cond)` -> "test"; `expect(x).toBe` -> "expect".
 */
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
 * Collect the member method names used in a callee chain.
 * Examples: `test.skip` -> ["skip"]; `test.skipIf(cond)` -> ["skipIf"];
 * `test.each(rows)` -> ["each"]; `test` -> [].
 */
function memberMethods(node: AstNode | undefined): string[] {
  const methods: string[] = [];
  let current = node;
  while (current) {
    if (current.type === "MemberExpression") {
      const property = asNode(current.property);
      if (
        property?.type === "Identifier" &&
        typeof property.name === "string"
      ) {
        methods.push(property.name);
      }
      current = asNode(current.object);
    } else if (current.type === "CallExpression") {
      current = asNode(current.callee);
    } else {
      break;
    }
  }
  return methods;
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

/** True when the subtree contains a call whose callee resolves to `expect`. */
function containsExpect(root: AstNode): boolean {
  let found = false;
  walk(root, (node) => {
    if (found || node.type !== "CallExpression") return;
    if (leftmostName(asNode(node.callee)) === "expect") found = true;
  });
  return found;
}

interface ReportDescriptor {
  node: AstNode;
  message: string;
}

interface RuleContext {
  report(descriptor: ReportDescriptor): void;
}

const MESSAGE =
  "Test has no assertions. Add at least one `expect()` call, or use `test.skip` / `test.todo` for an intentionally empty test.";

const expectExpect = {
  create(context: RuleContext) {
    return {
      CallExpression(node: AstNode) {
        const callee = asNode(node.callee);
        const base = leftmostName(callee);
        if (base !== "test" && base !== "it") return;

        // Skip the inner `test.skipIf(cond)` call of `test.skipIf(cond)(...)`:
        // only the outermost invocation carries the test callback.
        const parent = asNode(node.parent);
        if (parent?.type === "CallExpression" && asNode(parent.callee) === node)
          return;

        // Disabled/placeholder tests are not expected to assert.
        const methods = memberMethods(callee);
        if (methods.includes("skip") || methods.includes("todo")) return;

        const args = Array.isArray(node.arguments) ? node.arguments : [];
        const callback = args
          .map((arg) => asNode(arg))
          .find((arg) => isFunctionNode(arg));
        if (!callback) return;

        if (!containsExpect(callback)) {
          context.report({ node, message: MESSAGE });
        }
      },
    };
  },
};

const plugin = {
  meta: { name: "bun-test" },
  rules: { "expect-expect": expectExpect },
};

export default plugin;
