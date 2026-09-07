// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import plugin from "../../lint/no-bun-stdin";
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

/** Run the `runtime/no-bun-stdin` rule against a snippet; returns every reported message. */
function lint(source: string): string[] {
  // meriyah's Program type structurally satisfies the plugin's own loose
  // AstNode shape; the plugin doesn't export a type to convert through.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const program = parseJsModule(source) as unknown as AstNode;
  const messages: string[] = [];
  const visitor = plugin.rules["no-bun-stdin"].create({
    report({ message }) {
      messages.push(message);
    },
  });
  walkMembers(program, (member) => {
    visitor.MemberExpression(member);
  });
  return messages;
}

describe("no-bun-stdin", () => {
  test.each([
    ["a text read", "const t = await Bun.stdin.text();"],
    ["a stream read", "const s = Bun.stdin.stream();"],
    ["a bare reference", "const input = Bun.stdin;"],
  ])("reports %s", (_label, source) => {
    const messages = lint(source);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("readStdinText()");
  });

  test.each([
    ["the shared reader", "const t = await readStdinText();"],
    ["process.stdin", "for await (const c of process.stdin) use(c);"],
    ["another Bun member", "const f = Bun.file(path);"],
    ["stdin off another object", "const s = proc.stdin;"],
    ["a computed property", 'const s = Bun["stdin"];'],
  ])("permits %s", (_label, source) => {
    expect(lint(source)).toEqual([]);
  });
});
