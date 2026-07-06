// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { parseJsModule } from "../../src/engine/js-parser";

describe("parseJsModule", () => {
  test("parses a valid module into an ESTree Program with ordered body", () => {
    const program = parseJsModule(
      [
        'import { a } from "./a";',
        "const x = a + 1;",
        "export function run() {",
        "  return x;",
        "}",
        "",
      ].join("\n")
    );

    expect(program.type).toBe("Program");
    expect(program.sourceType).toBe("module");
    expect(program.body.map((node) => node.type)).toEqual([
      "ImportDeclaration",
      "VariableDeclaration",
      "ExportNamedDeclaration",
    ]);
  });

  test("throws on syntax errors", () => {
    expect(() => parseJsModule("const = ;")).toThrow();
    expect(() => parseJsModule("function ( {")).toThrow();
  });

  test("rejects JSX by default and parses it with the jsx option", () => {
    const source = "export const el = <div>hi</div>;";

    expect(() => parseJsModule(source)).toThrow();

    const program = parseJsModule(source, { jsx: true });
    expect(program.type).toBe("Program");
    expect(program.body).toHaveLength(1);
    expect(program.body[0].type).toBe("ExportNamedDeclaration");
  });

  test("includes loc information on nodes", () => {
    const program = parseJsModule("const x = 1;\nconst y = 2;\n");

    expect(program.loc).toBeDefined();
    expect(program.body[0].loc?.start.line).toBe(1);
    expect(program.body[1].loc?.start.line).toBe(2);
    expect(program.body[1].loc?.start.column).toBe(0);
  });
});
