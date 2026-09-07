// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import plugin from "../../lint/no-bare-fetch";
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

/** Depth-first walk handing every `CallExpression` to `visit`. */
function walkCalls(node: AstNode, visit: (call: AstNode) => void): void {
  if (node.type === "CallExpression") visit(node);
  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "loc" || key === "range") continue;
    const value = node[key];
    for (const item of Array.isArray(value) ? value : [value]) {
      if (isAstNode(item)) walkCalls(item, visit);
    }
  }
}

/** Run the `http/no-bare-fetch` rule against a snippet; returns every reported message. */
function lint(source: string): string[] {
  // meriyah's Program type structurally satisfies the plugin's own loose
  // AstNode shape; the plugin doesn't export a type to convert through.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const program = parseJsModule(source) as unknown as AstNode;
  const messages: string[] = [];
  const visitor = plugin.rules["no-bare-fetch"].create({
    report({ message }) {
      messages.push(message);
    },
  });
  walkCalls(program, (call) => {
    visitor.CallExpression(call);
  });
  return messages;
}

describe("no-bare-fetch", () => {
  test.each([
    ["an awaited call", "const r = await fetch(url);"],
    ["a call with init", 'const r = fetch(url, { method: "POST" });'],
    ["a returned call", "function f() { return fetch(url); }"],
    [
      "a call inside a callback",
      "const g = async (u, o) => await fetch(u, o);",
    ],
  ])("reports %s", (_label, source) => {
    const messages = lint(source);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("fetchWithUserAgent()");
  });

  test("reports each bare call separately", () => {
    expect(lint("await fetch(a); await fetch(b);")).toHaveLength(2);
  });

  test.each([
    ["the shared wrapper", "const r = await fetchWithUserAgent(url);"],
    ["a fetch method on another object", "const r = await client.fetch(url);"],
    ["a fetch property passed as an option", "new Client({ fetch: myFetch });"],
    ["a reference that is not called", "const f = fetch;"],
    ["a member named fetch", "const r = obj.fetch;"],
  ])("permits %s", (_label, source) => {
    expect(lint(source)).toEqual([]);
  });
});
