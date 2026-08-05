// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import plugin from "../../lint/no-first-party-module-mock";
import { parseJsModule } from "../../src/engine/js-parser";

/** Minimal ESTree-ish node shape, matching the plugin's own definition. */
type AstNode = { type: string } & Record<string, unknown>;

interface ReportedViolation {
  message: string;
}

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

/**
 * Run the `test-mocking/no-first-party-module-mock` rule against a source
 * snippet and return every reported violation. Parses via the sanctioned
 * in-process `meriyah` entry point (`parseJsModule`, ARCH-022).
 */
function lint(source: string): ReportedViolation[] {
  // meriyah's Program type structurally satisfies the plugin's own loose
  // AstNode shape; the plugin doesn't export a type to convert through.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const program = parseJsModule(source) as unknown as AstNode;
  const violations: ReportedViolation[] = [];
  const rule = plugin.rules["no-first-party-module-mock"];
  const visitor = rule.create({
    report({ message }) {
      violations.push({ message });
    },
  });
  walkCalls(program, (call) => {
    visitor.CallExpression(call);
  });
  return violations;
}

describe("no-first-party-module-mock", () => {
  test.each([
    ["../../src/helpers/registry"],
    ["../../../src/helpers/plugin-install"],
    ["../../../../src/commands/adr/domain/index"],
    ["./src/engine/loader"],
  ])("flags mock.module(%s)", (specifier) => {
    const violations = lint(`mock.module("${specifier}", () => ({}));`);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain(specifier);
  });

  test.each([
    ["inquirer"],
    ["node:readline"],
    ["node:fs"],
    ["@commander-js/extra-typings"],
  ])("allows mock.module(%s)", (specifier) => {
    expect(lint(`mock.module("${specifier}", () => ({}));`)).toHaveLength(0);
  });

  test("ignores a relative specifier with no src segment", () => {
    expect(lint(`mock.module("../fixtures/helper", () => ({}));`)).toHaveLength(
      0
    );
  });

  test("ignores a path segment that merely starts with src", () => {
    expect(lint(`mock.module("../srcfoo/thing", () => ({}));`)).toHaveLength(0);
  });

  test('flags the computed form mock["module"]', () => {
    const violations = lint(
      `mock["module"]("../../src/helpers/registry", () => ({}));`
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("ARCH-005");
  });

  test("ignores a computed key that is not a string literal", () => {
    expect(
      lint(`mock[key]("../../src/helpers/registry", () => ({}));`)
    ).toHaveLength(0);
  });

  test("ignores an unrelated mock call", () => {
    expect(lint(`mock(() => ({}));`)).toHaveLength(0);
  });

  test("ignores a module method on another object", () => {
    expect(
      lint(`other.module("../../src/helpers/registry", () => ({}));`)
    ).toHaveLength(0);
  });

  test("ignores a non-literal specifier", () => {
    expect(lint(`mock.module(specifier, () => ({}));`)).toHaveLength(0);
  });

  test("names spyOn as the replacement and cites ARCH-005", () => {
    const violations = lint(`mock.module("../../src/helpers/x", () => ({}));`);
    expect(violations[0]?.message).toContain("spyOn");
    expect(violations[0]?.message).toContain("ARCH-005");
  });
});
