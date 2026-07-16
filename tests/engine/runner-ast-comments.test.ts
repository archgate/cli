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
import type { LoadResult } from "../../src/engine/loader";
import { runChecks } from "../../src/engine/runner";
import type { AdrDocument } from "../../src/formats/adr";
import type {
  CommentToken,
  EsTreeProgram,
  PythonAstModule,
  RuleSet,
} from "../../src/formats/rules";
import { git, safeRmSync } from "../test-utils";

const pythonInterpreter = await probeInterpreter(
  interpreterCandidates("python")
);

function makeLoadedAdr(ruleSet: RuleSet): LoadResult {
  return {
    type: "loaded",
    value: {
      adr: {
        frontmatter: {
          id: "AST-CMT-001",
          title: "AST Comments Test",
          domain: "general",
          rules: true,
        },
        body: "",
        filePath: "/test.md",
      } as AdrDocument,
      ruleSet,
    },
  };
}

describe("ctx.ast({ comments: true })", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "archgate-ast-cmt-"));
    mkdirSync(join(dir, "src"), { recursive: true });
  });

  afterEach(() => safeRmSync(dir));

  test("typescript: extracts line and block comments with stripped values and original-source loc", async () => {
    writeFileSync(
      join(dir, "src/a.ts"),
      [
        "// header",
        "export const v: number = 1; // trailing",
        "/* block",
        "   spanning */",
        "",
      ].join("\n")
    );

    const captured: { comments?: CommentToken[] } = {};
    const loaded = makeLoadedAdr({
      rules: {
        r: {
          description: "collect comments",
          async check(ctx) {
            const tree = await ctx.ast("src/a.ts", "typescript", {
              comments: true,
            });
            captured.comments = tree.comments;
          },
        },
      },
    });

    await runChecks(dir, [loaded]);
    const comments = captured.comments ?? [];
    expect(comments.map((c) => `${c.type}:${c.value}`)).toEqual([
      "line: header",
      "line: trailing",
      "block: block\n   spanning ",
    ]);
    // Original-source line numbers survive TS transpilation (the tree's own
    // loc would not).
    expect(comments[0].loc.start.line).toBe(1);
    expect(comments[1].loc.start.line).toBe(2);
    expect(comments[2].loc.start.line).toBe(3);
    expect(comments[2].loc.end.line).toBe(4);
  });

  test("typescript: a comment marker inside a string is not a comment", async () => {
    writeFileSync(
      join(dir, "src/b.ts"),
      'export const url = "https://example.com"; // real\n'
    );

    const captured: { comments?: CommentToken[] } = {};
    const loaded = makeLoadedAdr({
      rules: {
        r: {
          description: "string-aware",
          async check(ctx) {
            const tree = await ctx.ast("src/b.ts", "typescript", {
              comments: true,
            });
            captured.comments = tree.comments;
          },
        },
      },
    });

    await runChecks(dir, [loaded]);
    const comments = captured.comments ?? [];
    expect(comments).toHaveLength(1);
    expect(comments[0].value).toBe(" real");
  });

  test("typescript: comment markers inside a template literal are not comments", async () => {
    // The template's text parts contain both `//` and `/* … */`; only the
    // standalone line comment below is a real comment. The original-source
    // scanner must skip markers inside the template wholesale (ARCH-022).
    await Bun.write(
      join(dir, "src/tpl.ts"),
      "const t = `x // not a comment /* nor this */ y`;\n// the only real comment\nexport const z = t;\n"
    );

    const captured: { comments?: CommentToken[] } = {};
    const loaded = makeLoadedAdr({
      rules: {
        r: {
          description: "template-aware",
          async check(ctx) {
            const tree = await ctx.ast("src/tpl.ts", "typescript", {
              comments: true,
            });
            captured.comments = tree.comments;
          },
        },
      },
    });

    await runChecks(dir, [loaded]);
    const comments = captured.comments ?? [];
    expect(comments).toHaveLength(1);
    expect(comments[0].value).toBe(" the only real comment");
  });

  test("javascript: comments collected from original source", async () => {
    writeFileSync(join(dir, "src/c.js"), "// c comment\nmodule.exports = 1;\n");

    const captured: { tree?: EsTreeProgram } = {};
    const loaded = makeLoadedAdr({
      rules: {
        r: {
          description: "js comments",
          async check(ctx) {
            captured.tree = await ctx.ast("src/c.js", "javascript", {
              comments: true,
            });
          },
        },
      },
    });

    await runChecks(dir, [loaded]);
    expect(captured.tree?.comments?.[0].value).toBe(" c comment");
  });

  test("no comments array is attached without the flag", async () => {
    writeFileSync(join(dir, "src/d.ts"), "// x\nexport const v = 1;\n");

    const captured: { hasComments?: boolean } = {};
    const loaded = makeLoadedAdr({
      rules: {
        r: {
          description: "opt-in only",
          async check(ctx) {
            const tree = await ctx.ast("src/d.ts", "typescript");
            captured.hasComments = "comments" in tree;
          },
        },
      },
    });

    await runChecks(dir, [loaded]);
    expect(captured.hasComments).toBe(false);
  });

  test("ruby with { comments: true } throws a clear unsupported error", async () => {
    writeFileSync(join(dir, "src/e.rb"), "# ruby comment\nx = 1\n");

    const loaded = makeLoadedAdr({
      rules: {
        r: {
          description: "ruby unsupported",
          async check(ctx) {
            await ctx.ast("src/e.rb", "ruby", { comments: true });
          },
        },
      },
    });

    const result = await runChecks(dir, [loaded]);
    expect(result.results[0].error).toContain("not supported yet");
  });

  test.skipIf(!pythonInterpreter)(
    "python: collects # comments via tokenize with stripped value and position",
    async () => {
      writeFileSync(
        join(dir, "src/f.py"),
        [
          "# module comment",
          "x = 1  # trailing",
          'y = "# not a comment"',
          "",
        ].join("\n")
      );

      const captured: { tree?: PythonAstModule } = {};
      const loaded = makeLoadedAdr({
        rules: {
          r: {
            description: "python comments",
            async check(ctx) {
              captured.tree = await ctx.ast("src/f.py", "python", {
                comments: true,
              });
            },
          },
        },
      });

      await runChecks(dir, [loaded]);
      const comments = captured.tree?.comments ?? [];
      expect(comments.map((c) => c.value)).toEqual([
        " module comment",
        " trailing",
      ]);
      expect(comments[0].type).toBe("line");
      expect(comments[0].loc.start.line).toBe(1);
      expect(comments[1].loc.start.line).toBe(2);
      // The tree is still a real Module (comments ride alongside it).
      expect(captured.tree?._type).toBe("Module");
    }
  );

  test.skipIf(!pythonInterpreter)(
    "python: base-revision parse can also collect comments",
    async () => {
      await git(["init", "--initial-branch=main"], dir);
      await git(["config", "user.email", "t@t.com"], dir);
      await git(["config", "user.name", "T"], dir);
      writeFileSync(join(dir, "src/g.py"), "# base comment\nx = 1\n");
      await git(["add", "."], dir);
      await git(["commit", "-m", "base"], dir);
      writeFileSync(join(dir, "src/g.py"), "# edited comment\nx = 1\n");

      const captured: { base?: string; head?: string } = {};
      const loaded = makeLoadedAdr({
        rules: {
          r: {
            description: "python base comments",
            async check(ctx) {
              const baseTree = await ctx.ast("src/g.py", "python", {
                rev: "base",
                comments: true,
              });
              const headTree = await ctx.ast("src/g.py", "python", {
                comments: true,
              });
              captured.base = baseTree.comments?.[0].value;
              captured.head = headTree.comments?.[0].value;
            },
          },
        },
      });

      await runChecks(dir, [loaded], { base: "HEAD" });
      expect(captured.base).toBe(" base comment");
      expect(captured.head).toBe(" edited comment");
    }
  );
});
