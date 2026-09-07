// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// Custom oxlint JS plugin: production code reads stdin through
// `readStdinText()` (src/helpers/stdin.ts), never `Bun.stdin`. A pending
// `Bun.stdin` read does not keep the event loop alive once module evaluation
// has finished, so a command action awaiting it on a Windows pipe exits 0
// with the input unread.

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

/** True for the `Bun.stdin` member expression itself. */
function isBunStdin(node: AstNode): boolean {
  if (node.type !== "MemberExpression") return false;
  if (staticPropertyName(node) !== "stdin") return false;
  const object = node.object;
  return (
    isAstNode(object) && object.type === "Identifier" && object.name === "Bun"
  );
}

interface RuleContext {
  report(descriptor: { node: AstNode; message: string }): void;
}

const MESSAGE =
  "Read stdin with `readStdinText()` from src/helpers/stdin.ts instead of `Bun.stdin`: a pending `Bun.stdin` read does not keep the event loop alive after module evaluation, so a command awaiting it on a Windows pipe exits with the input unread.";

const noBunStdin = {
  create(context: RuleContext) {
    return {
      MemberExpression(node: AstNode) {
        if (isBunStdin(node)) context.report({ node, message: MESSAGE });
      },
    };
  },
};

const plugin = {
  meta: { name: "runtime" },
  rules: { "no-bun-stdin": noBunStdin },
};

export default plugin;
