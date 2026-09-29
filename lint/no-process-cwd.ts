// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// Custom oxlint JS plugin: production code resolves the working directory
// through `currentDir()` / `tryCurrentDir()` (src/helpers/paths.ts), never
// `process.cwd()`, which throws a raw `ENOENT` in a deleted directory and so
// reaches the ARCH-012 boundary as an internal bug (exit 2, Sentry report).
// The helpers turn it into a `UserError` or a `null`.

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

/** The identifier name of a non-computed member property. */
function staticPropertyName(node: AstNode): string | undefined {
  if (node.computed === true) return undefined;
  const property = node.property;
  return isAstNode(property) &&
    property.type === "Identifier" &&
    typeof property.name === "string"
    ? property.name
    : undefined;
}

/** True for the `process.cwd` member expression itself. */
function isProcessCwd(node: AstNode): boolean {
  if (node.type !== "MemberExpression") return false;
  if (staticPropertyName(node) !== "cwd") return false;
  const object = node.object;
  return (
    isAstNode(object) &&
    object.type === "Identifier" &&
    object.name === "process"
  );
}

interface RuleContext {
  report(descriptor: { node: AstNode; message: string }): void;
}

const MESSAGE =
  "Resolve the working directory with `currentDir()` (or `tryCurrentDir()` in telemetry and diagnostics) from src/helpers/paths.ts instead of `process.cwd()`: it throws a raw ENOENT when the launch directory was deleted, which surfaces as an internal error (exit 2) and a Sentry report.";

const noProcessCwd = {
  create(context: RuleContext) {
    return {
      MemberExpression(node: AstNode) {
        if (isProcessCwd(node)) context.report({ node, message: MESSAGE });
      },
    };
  },
};

const plugin = {
  meta: { name: "cwd" },
  rules: { "no-process-cwd": noProcessCwd },
};

export default plugin;
