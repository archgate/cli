// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PYTHON_AST_PROGRAM,
  RUBY_AST_PROGRAM,
  findAstNodes,
  interpreterCandidates,
  parseAstJson,
  parseErrorMessage,
  probeInterpreter,
  runAstSubprocess,
} from "../../src/engine/ast-support";
import type { PythonAstNode } from "../../src/formats/rules";
import { isWindows } from "../../src/helpers/platform";

// Probe once at load time so interpreter-dependent tests can skipIf cleanly.
const pythonInterpreter = await probeInterpreter(
  interpreterCandidates("python")
);
const rubyInterpreter = await probeInterpreter(interpreterCandidates("ruby"));

describe("interpreterCandidates", () => {
  test("ruby has a single candidate", () => {
    expect(interpreterCandidates("ruby")).toEqual(["ruby"]);
  });

  test("python candidate order matches the platform", () => {
    const expected = isWindows()
      ? ["python", "python3", "py"]
      : ["python3", "python"];
    expect(interpreterCandidates("python")).toEqual(expected);
  });
});

describe("probeInterpreter", () => {
  test("returns null when no candidate exists", async () => {
    const result = await probeInterpreter([
      "definitely-not-a-real-binary-abc123",
    ]);
    expect(result).toBeNull();
  });

  test("returns null for an empty candidate list", async () => {
    expect(await probeInterpreter([])).toBeNull();
  });

  test("skips missing candidates and returns the first working one", async () => {
    // process.execPath is the running bun binary — always present and
    // `bun --version` exits 0 on every supported platform.
    const result = await probeInterpreter([
      "definitely-not-a-real-binary-abc123",
      process.execPath,
    ]);
    expect(result).toBe(process.execPath);
  });
});

describe("runAstSubprocess", () => {
  test("captures stdout on exit code 0", async () => {
    const { exitCode, stdout, stderr } = await runAstSubprocess([
      process.execPath,
      "-e",
      'console.log("hello-stdout")',
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("hello-stdout");
    expect(stderr).toBe("");
  });

  test("captures stderr and the non-zero exit code", async () => {
    const { exitCode, stdout, stderr } = await runAstSubprocess([
      process.execPath,
      "-e",
      'console.error("boom-stderr"); process.exit(3)',
    ]);
    expect(exitCode).toBe(3);
    expect(stderr).toContain("boom-stderr");
    expect(stdout).toBe("");
  });

  test("throws after the injected timeout and kills the subprocess", async () => {
    await expect(
      runAstSubprocess(
        [process.execPath, "-e", "setTimeout(() => {}, 30000)"],
        50
      )
    ).rejects.toThrow(/timed out after 50ms/iu);
  });
});

describe("parseAstJson", () => {
  test("returns parsed objects and arrays", () => {
    expect(
      parseAstJson('{"_type":"Module","body":[]}', "a.py", "python")
    ).toEqual({ _type: "Module", body: [] });
    expect(parseAstJson('["program",[]]', "a.rb", "ruby")).toEqual([
      "program",
      [],
    ]);
  });

  test("throws with an 'invalid JSON output' message on garbage", () => {
    expect(() => parseAstJson("not json at all", "a.py", "python")).toThrow(
      /invalid JSON output/u
    );
    expect(() => parseAstJson("", "b.rb", "ruby")).toThrow(
      'Failed to parse "b.rb" as ruby: interpreter produced invalid JSON output'
    );
  });
});

describe("parseErrorMessage", () => {
  test("extracts the first item from an AggregateError", () => {
    const err = new AggregateError(
      [new SyntaxError("unexpected token"), new Error("second")],
      "aggregate wrapper"
    );
    expect(parseErrorMessage(err)).toContain("unexpected token");
  });

  test("falls back to the message for an empty AggregateError", () => {
    const err = new AggregateError([], "aggregate wrapper");
    expect(parseErrorMessage(err)).toBe("aggregate wrapper");
  });

  test("returns the message of a plain Error", () => {
    expect(parseErrorMessage(new Error("plain message"))).toBe("plain message");
  });

  test("stringifies non-Error values", () => {
    expect(parseErrorMessage("string failure")).toBe("string failure");
    expect(parseErrorMessage(42)).toBe("42");
  });
});

describe("PYTHON_AST_PROGRAM end-to-end", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-ast-py-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test.skipIf(!pythonInterpreter)(
    "serializes a valid module to JSON with _type Module",
    async () => {
      const interpreter = pythonInterpreter ?? "python";
      const file = join(tempDir, "valid.py");
      writeFileSync(
        file,
        ["def greet(name):", '    return f"hi {name}"', ""].join("\n")
      );

      const { exitCode, stdout } = await runAstSubprocess([
        interpreter,
        "-c",
        PYTHON_AST_PROGRAM,
        file,
      ]);
      expect(exitCode).toBe(0);

      const tree = JSON.parse(stdout) as {
        _type: string;
        body: Array<{ _type: string; name?: string; lineno?: number }>;
      };
      expect(tree._type).toBe("Module");
      expect(tree.body).toHaveLength(1);
      expect(tree.body[0]._type).toBe("FunctionDef");
      expect(tree.body[0].name).toBe("greet");
      expect(tree.body[0].lineno).toBe(1);
    }
  );

  test.skipIf(!pythonInterpreter)(
    "strips UTF-8 BOM and parses correctly",
    async () => {
      const interpreter = pythonInterpreter ?? "python";
      const file = join(tempDir, "bom.py");
      writeFileSync(file, "﻿x = 42\n");

      const { exitCode, stdout } = await runAstSubprocess([
        interpreter,
        "-c",
        PYTHON_AST_PROGRAM,
        file,
      ]);
      expect(exitCode).toBe(0);

      const tree = JSON.parse(stdout) as { _type: string };
      expect(tree._type).toBe("Module");
    }
  );

  test.skipIf(!pythonInterpreter)(
    "exits 1 with a syntax message for invalid source",
    async () => {
      const interpreter = pythonInterpreter ?? "python";
      const file = join(tempDir, "invalid.py");
      writeFileSync(file, "def broken(:\n");

      const { exitCode, stderr } = await runAstSubprocess([
        interpreter,
        "-c",
        PYTHON_AST_PROGRAM,
        file,
      ]);
      expect(exitCode).toBe(1);
      expect(stderr.toLowerCase()).toContain("syntax");
    }
  );
});

describe("RUBY_AST_PROGRAM end-to-end", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-ast-rb-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test.skipIf(!rubyInterpreter)(
    "serializes a valid file to a JSON array starting with program",
    async () => {
      const interpreter = rubyInterpreter ?? "ruby";
      const file = join(tempDir, "valid.rb");
      writeFileSync(file, ["def hello", '  puts "hi"', "end", ""].join("\n"));

      const { exitCode, stdout } = await runAstSubprocess([
        interpreter,
        "-rripper",
        "-rjson",
        "-e",
        RUBY_AST_PROGRAM,
        file,
      ]);
      expect(exitCode).toBe(0);

      const sexp = JSON.parse(stdout) as unknown[];
      expect(Array.isArray(sexp)).toBe(true);
      expect(sexp[0]).toBe("program");
    }
  );

  test.skipIf(!rubyInterpreter)(
    "strips UTF-8 BOM and parses correctly",
    async () => {
      const interpreter = rubyInterpreter ?? "ruby";
      const file = join(tempDir, "bom.rb");
      writeFileSync(file, '﻿puts "hello"\n');

      const { exitCode, stdout } = await runAstSubprocess([
        interpreter,
        "-rripper",
        "-rjson",
        "-e",
        RUBY_AST_PROGRAM,
        file,
      ]);
      expect(exitCode).toBe(0);

      const sexp = JSON.parse(stdout) as unknown[];
      expect(Array.isArray(sexp)).toBe(true);
      expect(sexp[0]).toBe("program");
    }
  );

  test.skipIf(!rubyInterpreter)(
    "exits 1 with 'Ruby syntax error' for invalid source",
    async () => {
      const interpreter = rubyInterpreter ?? "ruby";
      const file = join(tempDir, "invalid.rb");
      writeFileSync(file, "def broken(\n");

      const { exitCode, stderr } = await runAstSubprocess([
        interpreter,
        "-rripper",
        "-rjson",
        "-e",
        RUBY_AST_PROGRAM,
        file,
      ]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Ruby syntax error");
    }
  );
});

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

  test("returns empty for primitive and null roots", () => {
    expect(findAstNodes(null, "Module")).toEqual([]);
    expect(findAstNodes("Module", "Module")).toEqual([]);
    expect(findAstNodes(42, "Module")).toEqual([]);
  });
});
