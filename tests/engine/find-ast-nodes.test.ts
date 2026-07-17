// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { findAstNodes } from "../../src/engine/ast-support";
import type { PythonAstNode } from "../../src/formats/rules";

describe("findAstNodes", () => {
  test("rewrites the hand-rolled collectFunctionDefs walker to a one-liner", () => {
    // Python-shaped (_type discriminant) tree, as ctx.ast(path, "python")
    // returns it.
    const tree = {
      _type: "Module",
      body: [
        { _type: "FunctionDef", name: "top_level", body: [] },
        {
          _type: "ClassDef",
          name: "Service",
          body: [
            { _type: "AsyncFunctionDef", name: "fetch", body: [] },
            { _type: "FunctionDef", name: "close", body: [] },
          ],
        },
      ],
    };

    const hits = findAstNodes(tree, "FunctionDef", "AsyncFunctionDef");
    expect(hits.map((n) => n.name)).toEqual(["top_level", "fetch", "close"]);
  });

  test("matches ESTree-shaped nodes via their type discriminant", () => {
    const program = {
      type: "Program",
      body: [
        {
          type: "FunctionDeclaration",
          id: { type: "Identifier", name: "hello" },
          params: [],
        },
        {
          type: "ExpressionStatement",
          expression: {
            type: "CallExpression",
            callee: { type: "Identifier", name: "hello" },
            arguments: [],
          },
        },
      ],
    };

    const identifiers = findAstNodes(program, "Identifier");
    expect(identifiers.map((n) => n.name)).toEqual(["hello", "hello"]);
    expect(findAstNodes(program, "CallExpression")).toHaveLength(1);
  });

  test("the root node itself is a match candidate", () => {
    const tree = { _type: "Module", body: [] };
    const hits = findAstNodes(tree, "Module");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBe(tree);
  });

  test("recurses through nested arrays", () => {
    const tree = {
      _type: "Matrix",
      rows: [
        [{ _type: "Cell", value: 1 }],
        [[{ _type: "Cell", value: 2 }], { _type: "Cell", value: 3 }],
      ],
    };
    expect(findAstNodes(tree, "Cell").map((n) => n.value)).toEqual([1, 2, 3]);
  });

  test("ruby sexp arrays are recursed but array-shaped nodes never match", () => {
    // Ripper.sexp carries its tag as element 0, not as an object field.
    const sexp = ["program", [["command", [["@ident", "puts", [1, 0]]]]]];
    expect(findAstNodes(sexp, "program", "command", "@ident")).toEqual([]);
  });

  test("prefers _type over an unrelated string field named type", () => {
    const handler = { _type: "ExceptHandler", type: "Name" };
    expect(findAstNodes(handler, "Name")).toEqual([]);
    expect(findAstNodes(handler, "ExceptHandler")).toEqual([handler]);
  });

  test("cycle guard terminates on self-referential objects and arrays", () => {
    const node: PythonAstNode = { _type: "Loop" };
    node.self = node;
    const ring: unknown[] = [node];
    ring.push(ring);
    node.items = ring;

    expect(findAstNodes(node, "Loop")).toEqual([node]);
  });

  test("a node reachable through two parents is collected once", () => {
    const shared = { _type: "Name", id: "x" };
    const tree = { _type: "Module", left: shared, right: shared };
    expect(findAstNodes(tree, "Name")).toEqual([shared]);
  });

  test("a deeply nested tree does not overflow the call stack", () => {
    // ~100k levels deep — far beyond the JS call-stack limit a recursive
    // walker would hit. Built leaf-up so the leaf sits at maximum depth.
    let node: PythonAstNode = { _type: "Leaf", value: "bottom" };
    for (let i = 0; i < 100_000; i++) {
      node = { _type: "Wrapper", body: [node] };
    }

    const hits = findAstNodes(node, "Leaf");
    expect(hits).toHaveLength(1);
    expect(hits[0].value).toBe("bottom");
  });

  test("returns empty for primitive and null roots", () => {
    expect(findAstNodes(null, "Module")).toEqual([]);
    expect(findAstNodes("Module", "Module")).toEqual([]);
    expect(findAstNodes(42, "Module")).toEqual([]);
  });
});
