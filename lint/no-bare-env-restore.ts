// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// Custom oxlint JS plugin: enforce that tests restore environment variables
// through `restoreEnv()` rather than a bare `Bun.env.X = original` assignment.
//
// Why this exists: `Bun.env.X = undefined` (and `process.env.X = undefined`)
// assigns the literal STRING "undefined" and leaves the key present — it does
// NOT unset. So the idiomatic-looking capture-and-restore
//   const original = Bun.env.HOME; ...; Bun.env.HOME = original;
// silently leaks HOME="undefined" whenever the variable was unset to begin
// with, which is the normal case on Windows for HOME and GIT_CONFIG_GLOBAL.
// Bun's test runner shares ONE process across test files, so the bogus value
// escapes into every later test file and into every subprocess they spawn.
// Nothing else catches this class of bug:
//   - tsc cannot: `Bun.env.X = original` is well-typed; the coercion to
//     "undefined" happens at runtime.
//   - tests cannot: the leak is invisible to the leaking file. It surfaces as
//     an unrelated, order-dependent failure in some LATER file — the 2026-07-15
//     incident where a leaked HOME="undefined" made `review-context` report
//     zero changed files.
// The invariant is purely syntactic, so it belongs in the linter.
//
// See ARCH-005 (Testing Standards) for the Do/Don't this rule enforces.
//
// The plugin runs natively as TypeScript under Bun, so there is no build step.

/** Minimal ESTree-ish node shape. The oxlint AST is ESLint-compatible. */
type AstNode = { type: string } & Record<string, unknown>;

/** Narrow an unknown value to an AST node (an object with a string `type`). */
function asNode(value: unknown): AstNode | undefined {
  if (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { type?: unknown }).type === "string"
  ) {
    return value as AstNode;
  }
  return undefined;
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

/** The identifier name of a non-computed member property, e.g. `HOME` in `Bun.env.HOME`. */
function staticPropertyName(node: AstNode): string | undefined {
  if (node.computed === true) return undefined;
  const property = asNode(node.property);
  if (property?.type === "Identifier" && typeof property.name === "string") {
    return property.name;
  }
  return undefined;
}

/**
 * True when the node is a dotted env access — `Bun.env.NAME` or
 * `process.env.NAME`.
 *
 * Computed access (`Bun.env[key]`) is deliberately NOT matched: a dynamic key
 * is the shape of a generic helper such as `restoreEnv` itself, not the
 * hand-rolled capture-and-restore idiom this rule targets.
 */
function envVarName(node: AstNode | undefined): string | undefined {
  if (node?.type !== "MemberExpression") return undefined;
  const name = staticPropertyName(node);
  if (name === undefined) return undefined;

  const object = asNode(node.object);
  if (object?.type !== "MemberExpression") return undefined;
  if (staticPropertyName(object) !== "env") return undefined;

  const base = asNode(object.object);
  if (base?.type !== "Identifier") return undefined;
  return base.name === "Bun" || base.name === "process" ? name : undefined;
}

/**
 * Names of local variables that captured an env value, e.g. `originalHome` in
 * `const originalHome = Bun.env.HOME`.
 *
 * This is what separates a restore from an override. Both are spelled
 * `Bun.env.HOME = <identifier>`; only a restore assigns back a value that was
 * itself read out of the environment. `Bun.env.HOME = tempDir` (an override
 * onto a mkdtemp path) is therefore left alone, with no reliance on a naming
 * convention like `original*`.
 */
function collectCapturedNames(root: AstNode): Set<string> {
  const captured = new Set<string>();
  walk(root, (node) => {
    if (node.type === "VariableDeclarator") {
      const id = asNode(node.id);
      if (
        id?.type === "Identifier" &&
        typeof id.name === "string" &&
        envVarName(asNode(node.init))
      ) {
        captured.add(id.name);
      }
      return;
    }
    if (node.type === "AssignmentExpression" && node.operator === "=") {
      const left = asNode(node.left);
      if (
        left?.type === "Identifier" &&
        typeof left.name === "string" &&
        envVarName(asNode(node.right))
      ) {
        captured.add(left.name);
      }
    }
  });
  return captured;
}

interface ReportDescriptor {
  node: AstNode;
  message: string;
}

interface RuleContext {
  report(descriptor: ReportDescriptor): void;
}

function message(varName: string, rhs: string): string {
  return `Restore \`${varName}\` with \`restoreEnv("${varName}", ${rhs})\` from tests/test-utils.ts instead of assigning it back directly. \`env.${varName} = ${rhs}\` sets the string "undefined" when ${rhs} is undefined rather than unsetting the key, leaking it into every later test file (ARCH-005).`;
}

const noBareEnvRestore = {
  create(context: RuleContext) {
    return {
      Program(node: AstNode) {
        const captured = collectCapturedNames(node);
        if (captured.size === 0) return;

        walk(node, (current) => {
          if (
            current.type !== "AssignmentExpression" ||
            current.operator !== "="
          ) {
            return;
          }
          const varName = envVarName(asNode(current.left));
          if (!varName) return;

          const right = asNode(current.right);
          if (right?.type !== "Identifier" || typeof right.name !== "string") {
            return;
          }
          if (!captured.has(right.name)) return;

          context.report({
            node: current,
            message: message(varName, right.name),
          });
        });
      },
    };
  },
};

const plugin = {
  meta: { name: "test-isolation" },
  rules: { "no-bare-env-restore": noBareEnvRestore },
};

export default plugin;
