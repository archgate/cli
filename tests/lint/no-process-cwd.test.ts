// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import plugin from "../../lint/no-process-cwd";
import { parseJsModule } from "../../src/engine/js-parser";

/** Minimal ESTree-ish node shape, matching the plugin's own definition. */
type AstNode = { type: string } & Record<string, unknown>;

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}

/** Depth-first walk handing every `MemberExpression` to `visit`. */
function walkMembers(node: AstNode, visit: (member: AstNode) => void): void {
  if (node.type === "MemberExpression") visit(node);
  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "loc" || key === "range") continue;
    const value = node[key];
    for (const item of Array.isArray(value) ? value : [value]) {
      if (isAstNode(item)) walkMembers(item, visit);
    }
  }
}

/** Run the `cwd/no-process-cwd` rule against a snippet; returns every reported message. */
function lint(source: string): string[] {
  // meriyah's Program type structurally satisfies the plugin's own loose
  // AstNode shape; the plugin doesn't export a type to convert through.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const program = parseJsModule(source) as unknown as AstNode;
  const messages: string[] = [];
  const visitor = plugin.rules["no-process-cwd"].create({
    report({ message }) {
      messages.push(message);
    },
  });
  walkMembers(program, (member) => {
    visitor.MemberExpression(member);
  });
  return messages;
}

describe("no-process-cwd", () => {
  test.each([
    ["a direct call", "const dir = process.cwd();"],
    ["a fallback", "const dir = root ?? process.cwd();"],
    ["a bare reference", "const getDir = process.cwd;"],
  ])("reports %s", (_label, source) => {
    const messages = lint(source);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("currentDir()");
  });

  test.each([
    ["the shared helper", "const dir = currentDir();"],
    ["the non-throwing helper", "const dir = tryCurrentDir();"],
    ["another process member", "const argv = process.argv;"],
    ["cwd off another object", "const dir = proc.cwd();"],
    ["a computed property", 'const dir = process["cwd"]();'],
  ])("permits %s", (_label, source) => {
    expect(lint(source)).toEqual([]);
  });
});
