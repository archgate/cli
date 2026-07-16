// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PYTHON_AST_PROGRAM,
  RUBY_AST_PROGRAM,
  RUBY_AST_WITH_COMMENTS_PROGRAM,
  interpreterCandidates,
  parseAstJson,
  parseErrorMessage,
  probeInterpreter,
  runAstSubprocess,
} from "../../src/engine/ast-support";
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

describe("RUBY_AST_WITH_COMMENTS_PROGRAM end-to-end", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-ast-rb-cmt-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  interface Envelope {
    _tree: unknown[];
    comments: Array<{
      type: string;
      value: string;
      loc: {
        start: { line: number; column: number };
        end: { line: number; column: number };
      };
    }>;
  }

  test.skipIf(!rubyInterpreter)(
    "emits the {_tree, comments} envelope with line and block tokens",
    async () => {
      const interpreter = rubyInterpreter ?? "ruby";
      const file = join(tempDir, "commented.rb");
      writeFileSync(
        file,
        [
          "# header",
          "x = 1 # trailing",
          "=begin",
          "block line one",
          "block line two",
          "=end",
          'y = "# not a comment"',
          "",
        ].join("\n")
      );

      const { exitCode, stdout } = await runAstSubprocess([
        interpreter,
        "-rripper",
        "-rjson",
        "-e",
        RUBY_AST_WITH_COMMENTS_PROGRAM,
        file,
      ]);
      expect(exitCode).toBe(0);

      const envelope = JSON.parse(stdout) as Envelope;
      expect(envelope._tree[0]).toBe("program");
      expect(envelope.comments.map((c) => `${c.type}:${c.value}`)).toEqual([
        "line: header",
        "line: trailing",
        "block:block line one\nblock line two",
      ]);
      // Line comments: loc from the (line, col) lex tuple, end at token end.
      expect(envelope.comments[0].loc).toEqual({
        start: { line: 1, column: 0 },
        end: { line: 1, column: 8 },
      });
      expect(envelope.comments[1].loc.start).toEqual({ line: 2, column: 6 });
      // Block token: ONE token spanning the =begin line through the =end line.
      expect(envelope.comments[2].loc.start).toEqual({ line: 3, column: 0 });
      expect(envelope.comments[2].loc.end).toEqual({ line: 6, column: 4 });
    }
  );

  test.skipIf(!rubyInterpreter)(
    "comment-free source yields an empty comments list",
    async () => {
      const interpreter = rubyInterpreter ?? "ruby";
      const file = join(tempDir, "plain.rb");
      writeFileSync(file, "x = 1\n");

      const { exitCode, stdout } = await runAstSubprocess([
        interpreter,
        "-rripper",
        "-rjson",
        "-e",
        RUBY_AST_WITH_COMMENTS_PROGRAM,
        file,
      ]);
      expect(exitCode).toBe(0);

      const envelope = JSON.parse(stdout) as Envelope;
      expect(envelope._tree[0]).toBe("program");
      expect(envelope.comments).toEqual([]);
    }
  );

  test.skipIf(!rubyInterpreter)(
    "reports character columns, not Ripper's byte offsets, on non-ASCII lines",
    async () => {
      const interpreter = rubyInterpreter ?? "ruby";
      const file = join(tempDir, "nonascii.rb");
      // Multi-byte é before and inside the comment: byte and char cols diverge.
      writeFileSync(file, "é = 1 # café\n");

      const { exitCode, stdout } = await runAstSubprocess([
        interpreter,
        "-rripper",
        "-rjson",
        "-e",
        RUBY_AST_WITH_COMMENTS_PROGRAM,
        file,
      ]);
      expect(exitCode).toBe(0);

      const envelope = JSON.parse(stdout) as Envelope;
      expect(envelope.comments).toHaveLength(1);
      expect(envelope.comments[0].value).toBe(" café");
      // Char cols 6..12, matching Python tokenize on the same layout (bytes: 7..14).
      expect(envelope.comments[0].loc).toEqual({
        start: { line: 1, column: 6 },
        end: { line: 1, column: 12 },
      });
    }
  );

  test.skipIf(!rubyInterpreter)(
    "normalizes CRLF in block values so content is OS-independent",
    async () => {
      const interpreter = rubyInterpreter ?? "ruby";
      const file = join(tempDir, "crlf.rb");
      writeFileSync(
        file,
        "x = 1\r\n=begin\r\nblock one\r\nblock two\r\n=end\r\n"
      );

      const { exitCode, stdout } = await runAstSubprocess([
        interpreter,
        "-rripper",
        "-rjson",
        "-e",
        RUBY_AST_WITH_COMMENTS_PROGRAM,
        file,
      ]);
      expect(exitCode).toBe(0);

      const envelope = JSON.parse(stdout) as Envelope;
      // LF-joined on every OS — POSIX reads keep the \r bytes, Windows strips them.
      expect(envelope.comments.map((c) => `${c.type}:${c.value}`)).toEqual([
        "block:block one\nblock two",
      ]);
      expect(envelope.comments[0].loc.start).toEqual({ line: 2, column: 0 });
      expect(envelope.comments[0].loc.end).toEqual({ line: 5, column: 4 });
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
        RUBY_AST_WITH_COMMENTS_PROGRAM,
        file,
      ]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Ruby syntax error");
    }
  );
});
