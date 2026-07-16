// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  interpreterCandidates,
  probeInterpreter,
} from "../../src/engine/ast-support";
import type { LoadResult } from "../../src/engine/loader";
import { runChecks } from "../../src/engine/runner";
import type { RuleSet } from "../../src/formats/rules";

// Probe once at load time so interpreter-dependent tests can skipIf cleanly.
const pythonInterpreter = await probeInterpreter(
  interpreterCandidates("python")
);

describe("runChecks ctx.findAstNodes()", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-runner-find-"));
    mkdirSync(join(tempDir, "src"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeLoadedAdr(ruleSet: RuleSet): LoadResult {
    return {
      type: "loaded",
      value: {
        adr: {
          frontmatter: {
            id: "FIND-001",
            title: "findAstNodes Test",
            domain: "general",
            rules: true,
          },
          body: "",
          filePath: "/test.md",
        },
        ruleSet,
      },
    };
  }

  test("typescript: replaces a hand-rolled walker with a one-liner", async () => {
    writeFileSync(
      join(tempDir, "src", "calls.ts"),
      [
        "export function outer(): void {",
        "  inner();",
        "}",
        "",
        "function inner(): void {}",
        "",
      ].join("\n")
    );

    let fnNames: unknown[] = [];
    let callCount = 0;

    const loaded = makeLoadedAdr({
      rules: {
        "collect-declarations": {
          description: "Collect nodes without a hand-rolled recursive walker",
          async check(ctx) {
            const program = await ctx.ast("src/calls.ts", "typescript");
            const fns = ctx.findAstNodes(program, "FunctionDeclaration");
            fnNames = fns.map(
              (n) => (n.id as { name?: string } | undefined)?.name
            );
            callCount = ctx.findAstNodes(program, "CallExpression").length;
          },
        },
      },
    });

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].error).toBeUndefined();
    // The export-wrapped declaration is found too — the collector recurses
    // through every own-enumerable value, not just Program.body.
    expect(fnNames).toEqual(["outer", "inner"]);
    expect(callCount).toBe(1);
  });

  test.skipIf(!pythonInterpreter)(
    "python: multi-type match over real ast output",
    async () => {
      writeFileSync(
        join(tempDir, "src", "svc.py"),
        [
          "def sync_fn():",
          "    pass",
          "",
          "async def async_fn():",
          "    pass",
          "",
        ].join("\n")
      );

      let names: unknown[] = [];

      const loaded = makeLoadedAdr({
        rules: {
          "collect-defs": {
            description: "One-liner replacement for collectFunctionDefs",
            async check(ctx) {
              const tree = await ctx.ast("src/svc.py", "python");
              names = ctx
                .findAstNodes(tree, "FunctionDef", "AsyncFunctionDef")
                .map((n) => n.name);
            },
          },
        },
      });

      const result = await runChecks(tempDir, [loaded]);
      expect(result.results[0].error).toBeUndefined();
      expect(names).toEqual(["sync_fn", "async_fn"]);
    }
  );
});
