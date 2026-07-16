// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  interpreterCandidates,
  probeInterpreter,
} from "../../src/engine/ast-support";
import { getFileAtRev, getMergeBase } from "../../src/engine/git-files";
import type { LoadResult } from "../../src/engine/loader";
import { runChecks } from "../../src/engine/runner";
import type { AdrDocument } from "../../src/formats/adr";
import type { PythonAstNode, RuleSet } from "../../src/formats/rules";
import { git, safeRmSync } from "../test-utils";

const pythonInterpreter = await probeInterpreter(
  interpreterCandidates("python")
);

/**
 * Structural signature of a Python AST that ignores position attributes, so two
 * trees differing only in comments/formatting compare equal — the "executable
 * equivalence" a documentation-only-change rule is built on.
 */
function pyStructure(node: unknown): unknown {
  if (Array.isArray(node)) return node.map((n) => pyStructure(n));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as PythonAstNode)) {
      if (
        key === "lineno" ||
        key === "col_offset" ||
        key === "end_lineno" ||
        key === "end_col_offset"
      ) {
        continue;
      }
      out[key] = pyStructure(value);
    }
    return out;
  }
  return node;
}

function makeLoadedAdr(
  ruleSet: RuleSet,
  overrides: Partial<AdrDocument["frontmatter"]> = {}
): LoadResult {
  return {
    type: "loaded",
    value: {
      adr: {
        frontmatter: {
          id: "AST-BASE-001",
          title: "AST Base Test",
          domain: "general",
          rules: true,
          ...overrides,
        },
        body: "",
        filePath: "/test.md",
      },
      ruleSet,
    },
  };
}

describe("base-revision git reads", () => {
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "archgate-ast-base-git-"));
    await git(["init", "--initial-branch=main"], dir);
    await git(["config", "user.email", "t@t.com"], dir);
    await git(["config", "user.name", "T"], dir);
  });

  afterEach(() => safeRmSync(dir));

  test("getFileAtRev returns committed content; null for an absent path", async () => {
    writeFileSync(join(dir, "a.py"), "x = 1  # v1\n");
    await git(["add", "a.py"], dir);
    await git(["commit", "-m", "init"], dir);

    expect(await getFileAtRev(dir, "HEAD", "a.py")).toBe("x = 1  # v1\n");
    expect(await getFileAtRev(dir, "HEAD", "missing.py")).toBeNull();
  });

  test("getMergeBase of HEAD and HEAD is HEAD", async () => {
    writeFileSync(join(dir, "a.py"), "x = 1\n");
    await git(["add", "a.py"], dir);
    await git(["commit", "-m", "init"], dir);
    const head = await git(["rev-parse", "HEAD"], dir);

    expect(await getMergeBase(dir, "HEAD")).toBe(head);
  });

  test("getMergeBase returns null for an unknown ref", async () => {
    writeFileSync(join(dir, "a.py"), "x = 1\n");
    await git(["add", "a.py"], dir);
    await git(["commit", "-m", "init"], dir);

    expect(await getMergeBase(dir, "no-such-ref")).toBeNull();
  });
});

describe("runChecks ctx.fileAtBase() / ctx.ast({ rev: 'base' })", () => {
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "archgate-ast-base-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    await git(["init", "--initial-branch=main"], dir);
    await git(["config", "user.email", "t@t.com"], dir);
    await git(["config", "user.name", "T"], dir);
  });

  afterEach(() => safeRmSync(dir));

  /** Commit `content` at path, then overwrite the working tree with `next`. */
  async function commitThenEdit(path: string, content: string, next: string) {
    writeFileSync(join(dir, path), content);
    await git(["add", path], dir);
    await git(["commit", "-m", "base"], dir);
    writeFileSync(join(dir, path), next);
  }

  test("fileAtBase returns the committed source when the working tree is edited", async () => {
    await commitThenEdit(
      "src/a.ts",
      "export const v = 1;\n",
      "export const v = 2;\n"
    );

    let base: string | null = "unset";
    const loaded = makeLoadedAdr({
      rules: {
        r: {
          description: "read base",
          async check(ctx) {
            base = await ctx.fileAtBase("src/a.ts");
          },
        },
      },
    });

    await runChecks(dir, [loaded], { base: "HEAD" });
    expect(base).toBe("export const v = 1;\n");
  });

  test("fileAtBase returns null with no --base, and for a file absent at base", async () => {
    await commitThenEdit(
      "src/a.ts",
      "export const v = 1;\n",
      "export const v = 2;\n"
    );
    writeFileSync(join(dir, "src/added.ts"), "export const n = 1;\n");

    let noBase: string | null = "unset";
    let addedAtBase: string | null = "unset";
    const loaded = makeLoadedAdr({
      rules: {
        r: {
          description: "null cases",
          async check(ctx) {
            addedAtBase = await ctx.fileAtBase("src/added.ts");
          },
        },
      },
    });

    // With a base: the added file did not exist at base -> null.
    await runChecks(dir, [loaded], { base: "HEAD" });
    expect(addedAtBase).toBeNull();

    // Without a base: fileAtBase is always null.
    const loaded2 = makeLoadedAdr({
      rules: {
        r: {
          description: "no base",
          async check(ctx) {
            noBase = await ctx.fileAtBase("src/a.ts");
          },
        },
      },
    });
    await runChecks(dir, [loaded2]);
    expect(noBase).toBeNull();
  });

  test("typescript: ast({rev:'base'}) parses the base; working-tree ast parses the edit", async () => {
    await commitThenEdit(
      "src/a.ts",
      "export function foo() {}\n",
      "export function bar() {}\n"
    );

    let baseNames: string[] = [];
    let headNames: string[] = [];
    const loaded = makeLoadedAdr({
      rules: {
        r: {
          description: "compare base vs head",
          async check(ctx) {
            const baseTree = await ctx.ast("src/a.ts", "typescript", {
              rev: "base",
            });
            const headTree = await ctx.ast("src/a.ts", "typescript");
            baseNames = baseTree.body.map(
              (n) =>
                (n as { declaration?: { id?: { name?: string } } }).declaration
                  ?.id?.name ?? ""
            );
            headNames = headTree.body.map(
              (n) =>
                (n as { declaration?: { id?: { name?: string } } }).declaration
                  ?.id?.name ?? ""
            );
          },
        },
      },
    });

    await runChecks(dir, [loaded], { base: "HEAD" });
    expect(baseNames).toContain("foo");
    expect(headNames).toContain("bar");
  });

  test("typescript: a comment-only edit yields structurally identical trees", async () => {
    await commitThenEdit(
      "src/a.ts",
      "export const v = 1;\n",
      "// a new explanatory comment\nexport const v = 1;\n"
    );

    let equal = false;
    const loaded = makeLoadedAdr({
      rules: {
        r: {
          description: "doc-only detection",
          async check(ctx) {
            const baseTree = await ctx.ast("src/a.ts", "typescript", {
              rev: "base",
            });
            const headTree = await ctx.ast("src/a.ts", "typescript");
            // Comments are not ESTree nodes and loc is transpiled-relative, so
            // the bodies match structurally when only a comment was added.
            equal =
              JSON.stringify(baseTree.body.map((n) => n.type)) ===
              JSON.stringify(headTree.body.map((n) => n.type));
          },
        },
      },
    });

    await runChecks(dir, [loaded], { base: "HEAD" });
    expect(equal).toBe(true);
  });

  test("ast({rev:'base'}) throws with no base resolved", async () => {
    writeFileSync(join(dir, "src/a.ts"), "export const v = 1;\n");
    await git(["add", "."], dir);
    await git(["commit", "-m", "init"], dir);

    const loaded = makeLoadedAdr({
      rules: {
        r: {
          description: "no base throws",
          async check(ctx) {
            await ctx.ast("src/a.ts", "typescript", { rev: "base" });
          },
        },
      },
    });

    const result = await runChecks(dir, [loaded]);
    expect(result.results[0].error).toContain("needs a base revision");
  });

  test("ast({rev:'base'}) throws for a file that did not exist at base", async () => {
    writeFileSync(join(dir, "src/a.ts"), "export const v = 1;\n");
    await git(["add", "."], dir);
    await git(["commit", "-m", "init"], dir);
    writeFileSync(join(dir, "src/added.ts"), "export const n = 1;\n");

    const loaded = makeLoadedAdr({
      rules: {
        r: {
          description: "added file throws",
          async check(ctx) {
            await ctx.ast("src/added.ts", "typescript", { rev: "base" });
          },
        },
      },
    });

    const result = await runChecks(dir, [loaded], { base: "HEAD" });
    expect(result.results[0].error).toContain("did not exist at the base");
  });

  test.skipIf(!pythonInterpreter)(
    "python: comment/docstring-only edit is executable-equivalent; real edit is not",
    async () => {
      const baseSrc =
        'def add(a, b):\n    """Add two numbers."""\n    return a + b  # sum\n';
      const docOnly =
        'def add(a, b):\n    """Return the sum of a and b."""\n    # changed comment\n    return a + b\n';
      await commitThenEdit("src/calc.py", baseSrc, docOnly);

      // Captured on an object so the closure's assignments are not narrowed
      // away in the outer scope (TS treats a nested-closure write to a plain
      // `let` as never happening).
      const seen: { doc?: boolean; real?: boolean } = {};
      const loaded = makeLoadedAdr({
        rules: {
          r: {
            description: "python doc-only",
            async check(ctx) {
              const baseTree = await ctx.ast("src/calc.py", "python", {
                rev: "base",
              });
              const headTree = await ctx.ast("src/calc.py", "python");
              // A doc-only rule strips docstrings (their value legitimately
              // changed) and compares the rest, position-insensitively.
              seen.doc =
                JSON.stringify(pyStructure(stripDocstrings(baseTree))) ===
                JSON.stringify(pyStructure(stripDocstrings(headTree)));

              // A real change to the working tree body.
              writeFileSync(
                join(dir, "src/calc.py"),
                "def add(a, b):\n    return a - b\n"
              );
              const realTree = await ctx.ast("src/calc.py", "python");
              seen.real =
                JSON.stringify(pyStructure(stripDocstrings(baseTree))) ===
                JSON.stringify(pyStructure(stripDocstrings(realTree)));
            },
          },
        },
      });

      await runChecks(dir, [loaded], { base: "HEAD" });
      expect(seen.doc).toBe(true);
      expect(seen.real).toBe(false);
    }
  );
});

/**
 * Remove docstring statements (a leading string-literal expression) from every
 * function/class/module body, mirroring what a real documentation-only rule
 * does before comparing executable structure.
 */
function stripDocstrings<T>(node: T): T {
  if (Array.isArray(node))
    return node.map((n) => stripDocstrings(n)) as unknown as T;
  if (node && typeof node === "object") {
    const n = node as unknown as PythonAstNode;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(n)) {
      if (key === "body" && Array.isArray(value)) {
        const body = value as PythonAstNode[];
        const first = body[0];
        const isDoc =
          first?._type === "Expr" &&
          (first.value as PythonAstNode | undefined)?._type === "Constant" &&
          typeof (first.value as { value?: unknown } | undefined)?.value ===
            "string";
        out[key] = (isDoc ? body.slice(1) : body).map((n) =>
          stripDocstrings(n)
        );
      } else {
        out[key] = stripDocstrings(value);
      }
    }
    return out as unknown as T;
  }
  return node;
}
