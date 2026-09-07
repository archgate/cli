// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// Custom oxlint JS plugin: production code sends HTTP through
// `fetchWithUserAgent()` (src/helpers/user-agent.ts), never the global
// `fetch`. The wrapper is where the versioned `User-Agent` header is set;
// a bare call ships a request the receiving service cannot attribute to a
// CLI version, and nothing else notices.

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

/** True for a call whose callee is the bare identifier `fetch`. */
function isBareFetchCall(node: AstNode): boolean {
  if (node.type !== "CallExpression") return false;
  const callee = node.callee;
  return (
    isAstNode(callee) && callee.type === "Identifier" && callee.name === "fetch"
  );
}

interface RuleContext {
  report(descriptor: { node: AstNode; message: string }): void;
}

const MESSAGE =
  "Send HTTP requests through `fetchWithUserAgent()` from src/helpers/user-agent.ts instead of the global `fetch`: the wrapper sets the versioned `User-Agent` header that lets services attribute traffic to a CLI version.";

const noBareFetch = {
  create(context: RuleContext) {
    return {
      CallExpression(node: AstNode) {
        if (isBareFetchCall(node)) context.report({ node, message: MESSAGE });
      },
    };
  },
};

const plugin = {
  meta: { name: "http" },
  rules: { "no-bare-fetch": noBareFetch },
};

export default plugin;
