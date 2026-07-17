// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
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
import type { RuleSet } from "../../src/formats/rules";
import { git, safeRmSync } from "../test-utils";

// Probe once at load time so interpreter-dependent tests can skipIf cleanly.
const pythonInterpreter = await probeInterpreter(
  interpreterCandidates("python")
);

function makeLoadedAdr(
  ruleSet: RuleSet,
  overrides: Partial<AdrDocument["frontmatter"]> = {}
): LoadResult {
  return {
    type: "loaded",
    value: {
      adr: {
        frontmatter: {
          id: "AST-CACHE-001",
          title: "AST Cache Test",
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

/** Count Bun.spawn calls that are Python AST parses (argv[1] is "-I"). */
function countAstSpawns(spy: { mock: { calls: unknown[][] } }): number {
  return spy.mock.calls.filter((args) => {
    const cmd = args[0];
    return Array.isArray(cmd) && cmd[1] === "-I";
  }).length;
}

describe("runChecks ctx.ast() per-run parse cache", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-ast-cache-"));
    mkdirSync(join(tempDir, "src"), { recursive: true });
  });

  afterEach(() => safeRmSync(tempDir));

  test("identical calls across rules share one parse (same tree instance)", async () => {
    writeFileSync(join(tempDir, "src", "a.ts"), "export const v = 1;\n");

    // Each in-process parse produces a fresh object, so instance identity
    // across three rules proves exactly one parse ran for the whole run.
    const trees: unknown[] = [];
    const rule = (name: string) => ({
      description: `parse from rule ${name}`,
      async check(ctx: Parameters<RuleSet["rules"][string]["check"]>[0]) {
        trees.push(await ctx.ast("src/a.ts", "typescript"));
      },
    });

    const loaded = makeLoadedAdr({
      rules: { one: rule("one"), two: rule("two"), three: rule("three") },
    });
    const result = await runChecks(tempDir, [loaded]);

    expect(result.results.every((r) => r.error === undefined)).toBe(true);
    expect(trees).toHaveLength(3);
    expect(trees[1]).toBe(trees[0]);
    expect(trees[2]).toBe(trees[0]);
  });

  test("concurrent identical calls collapse into one in-flight parse", async () => {
    writeFileSync(join(tempDir, "src", "b.ts"), "export const n = 2;\n");

    let same = false;
    const loaded = makeLoadedAdr({
      rules: {
        concurrent: {
          description: "two overlapping parses of the same file",
          async check(ctx) {
            const [t1, t2] = await Promise.all([
              ctx.ast("src/b.ts", "typescript"),
              ctx.ast("src/b.ts", "typescript"),
            ]);
            same = t1 === t2;
          },
        },
      },
    });

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].error).toBeUndefined();
    expect(same).toBe(true);
  });

  test.skipIf(!pythonInterpreter)(
    "python: interpreter spawn count does not scale with rule count",
    async () => {
      writeFileSync(join(tempDir, "src", "calc.py"), "x = 1\n");

      const trees: unknown[] = [];
      const rule = (name: string) => ({
        description: `parse from rule ${name}`,
        async check(ctx: Parameters<RuleSet["rules"][string]["check"]>[0]) {
          trees.push(await ctx.ast("src/calc.py", "python"));
        },
      });

      const spawnSpy = spyOn(Bun, "spawn");
      try {
        const loaded = makeLoadedAdr({
          rules: { one: rule("one"), two: rule("two"), three: rule("three") },
        });
        const result = await runChecks(tempDir, [loaded]);

        expect(result.results.every((r) => r.error === undefined)).toBe(true);
        // Three rules, one subprocess: the parse promise is shared.
        expect(countAstSpawns(spawnSpy)).toBe(1);
        expect(trees[1]).toBe(trees[0]);
        expect(trees[2]).toBe(trees[0]);
      } finally {
        spawnSpy.mockRestore();
      }
    }
  );

  test("comments: true and false/omitted cache independently", async () => {
    writeFileSync(
      join(tempDir, "src", "c.ts"),
      "// a comment\nexport const v = 1;\n"
    );

    const trees: Record<string, unknown> = {};
    const loaded = makeLoadedAdr({
      rules: {
        variants: {
          description: "parse with and without comments",
          async check(ctx) {
            trees.plain = await ctx.ast("src/c.ts", "typescript");
            trees.withComments = await ctx.ast("src/c.ts", "typescript", {
              comments: true,
            });
            trees.explicitFalse = await ctx.ast("src/c.ts", "typescript", {
              comments: false,
            });
          },
        },
      },
    });

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].error).toBeUndefined();
    // Different outputs never collide...
    expect(trees.withComments).not.toBe(trees.plain);
    expect(
      (trees.withComments as { comments?: unknown[] }).comments
    ).toBeDefined();
    expect((trees.plain as { comments?: unknown[] }).comments).toBeUndefined();
    // ...while `comments: false` and omitted are the same tuple, so they share.
    expect(trees.explicitFalse).toBe(trees.plain);
  });

  test("rev: 'base' and working-tree parses cache independently", async () => {
    await git(["init", "--initial-branch=main"], tempDir);
    await git(["config", "user.email", "t@t.com"], tempDir);
    await git(["config", "user.name", "T"], tempDir);
    writeFileSync(join(tempDir, "src", "d.ts"), "export function foo() {}\n");
    await git(["add", "."], tempDir);
    await git(["commit", "-m", "base"], tempDir);
    writeFileSync(join(tempDir, "src", "d.ts"), "export function bar() {}\n");

    const trees: Record<string, unknown> = {};
    const names: Record<string, string> = {};
    const loaded = makeLoadedAdr({
      rules: {
        revs: {
          description: "base and working-tree parses",
          async check(ctx) {
            trees.base1 = await ctx.ast("src/d.ts", "typescript", {
              rev: "base",
            });
            trees.head1 = await ctx.ast("src/d.ts", "typescript");
            trees.base2 = await ctx.ast("src/d.ts", "typescript", {
              rev: "base",
            });
            trees.head2 = await ctx.ast("src/d.ts", "typescript");
            const name = (tree: unknown) =>
              (tree as { body: { declaration?: { id?: { name?: string } } }[] })
                .body[0]?.declaration?.id?.name ?? "";
            names.base = name(trees.base1);
            names.head = name(trees.head1);
          },
        },
      },
    });

    const result = await runChecks(tempDir, [loaded], { base: "HEAD" });
    expect(result.results[0].error).toBeUndefined();
    // Distinct revisions never collide; repeats within a revision share.
    expect(trees.base1).not.toBe(trees.head1);
    expect(trees.base2).toBe(trees.base1);
    expect(trees.head2).toBe(trees.head1);
    expect(names.base).toBe("foo");
    expect(names.head).toBe("bar");
  });

  test("a rejected parse is served from cache: identical error instance", async () => {
    writeFileSync(join(tempDir, "src", "broken.ts"), "const = {\n");

    // Deliberate decision: rejected promises stay cached, so every rule
    // touching the same input fails fast with the SAME error (fail-closed,
    // consistent with ctx.ast()'s ARCH-022 throw contract).
    const errors: unknown[] = [];
    const rule = (name: string) => ({
      description: `catch parse failure in rule ${name}`,
      async check(ctx: Parameters<RuleSet["rules"][string]["check"]>[0]) {
        try {
          await ctx.ast("src/broken.ts", "typescript");
        } catch (err) {
          errors.push(err);
        }
      },
    });

    const loaded = makeLoadedAdr({
      rules: { one: rule("one"), two: rule("two") },
    });
    await runChecks(tempDir, [loaded]);

    expect(errors).toHaveLength(2);
    expect(errors[1]).toBe(errors[0]);
    expect((errors[0] as Error).message).toContain("Failed to parse");
  });

  test("aliased path spellings share one cache entry and a normalized error message", async () => {
    writeFileSync(join(tempDir, "src", "broken2.ts"), "const = {\n");

    // "src/./broken2.ts" and "src/broken2.ts" resolve to the same absPath,
    // so both spellings hit one cache entry. The cached rejection must not
    // leak the first caller's raw spelling: the message always carries the
    // normalized repo-relative path.
    const errors: unknown[] = [];
    const rule = (spelling: string) => ({
      description: `parse via spelling ${spelling}`,
      async check(ctx: Parameters<RuleSet["rules"][string]["check"]>[0]) {
        try {
          await ctx.ast(spelling, "typescript");
        } catch (err) {
          errors.push(err);
        }
      },
    });

    const loaded = makeLoadedAdr({
      rules: {
        aliased: rule("src/./broken2.ts"),
        canonical: rule("src/broken2.ts"),
      },
    });
    await runChecks(tempDir, [loaded]);

    expect(errors).toHaveLength(2);
    // One cache entry for both spellings: the very same error instance.
    expect(errors[1]).toBe(errors[0]);
    const message = (errors[0] as Error).message;
    expect(message).toContain('"src/broken2.ts"');
    expect(message).not.toContain("src/./broken2.ts");
  });

  test.skipIf(!pythonInterpreter)(
    "python: a rejected parse does not spawn a second interpreter",
    async () => {
      writeFileSync(join(tempDir, "src", "bad.py"), "def broken(:\n");

      const errors: unknown[] = [];
      const rule = (name: string) => ({
        description: `catch parse failure in rule ${name}`,
        async check(ctx: Parameters<RuleSet["rules"][string]["check"]>[0]) {
          try {
            await ctx.ast("src/bad.py", "python");
          } catch (err) {
            errors.push(err);
          }
        },
      });

      const spawnSpy = spyOn(Bun, "spawn");
      try {
        const loaded = makeLoadedAdr({
          rules: { one: rule("one"), two: rule("two") },
        });
        await runChecks(tempDir, [loaded]);

        expect(countAstSpawns(spawnSpy)).toBe(1);
        expect(errors).toHaveLength(2);
        expect(errors[1]).toBe(errors[0]);
        expect((errors[0] as Error).message).toContain("Failed to parse");
      } finally {
        spawnSpy.mockRestore();
      }
    }
  );
});
