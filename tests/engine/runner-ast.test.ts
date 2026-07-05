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
import { getExitCode } from "../../src/engine/reporter";
import { runChecks } from "../../src/engine/runner";
import type { AdrDocument } from "../../src/formats/adr";
import type { RuleSet } from "../../src/formats/rules";

// Probe once at load time so interpreter-dependent tests can skipIf cleanly.
const pythonInterpreter = await probeInterpreter(
  interpreterCandidates("python")
);
const rubyInterpreter = await probeInterpreter(interpreterCandidates("ruby"));

/** Recursively collect Python AST nodes matching a predicate. */
function collectPyNodes(
  node: unknown,
  predicate: (record: Record<string, unknown>) => boolean,
  hits: Array<Record<string, unknown>>
): void {
  if (Array.isArray(node)) {
    for (const item of node) collectPyNodes(item, predicate, hits);
    return;
  }
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (predicate(record)) hits.push(record);
    for (const value of Object.values(record)) {
      collectPyNodes(value, predicate, hits);
    }
  }
}

/** Recursively search a Ripper sexp for an @ident token with a given name. */
function sexpHasIdent(node: unknown, name: string): boolean {
  if (!Array.isArray(node)) return false;
  if (node[0] === "@ident" && node[1] === name) return true;
  return node.some((item) => sexpHasIdent(item, name));
}

describe("runChecks ctx.ast()", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-runner-ast-"));
    mkdirSync(join(tempDir, "src"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const EMPTY_RULE_SET: RuleSet = { rules: {} };

  function makeLoadedAdr(
    overrides: Partial<AdrDocument["frontmatter"]> = {},
    ruleSet: RuleSet = EMPTY_RULE_SET
  ): LoadResult {
    return {
      type: "loaded",
      value: {
        adr: {
          frontmatter: {
            id: "AST-001",
            title: "AST Test",
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

  test("typescript: rule walks an ESTree Program and reports from AST evidence", async () => {
    writeFileSync(
      join(tempDir, "src", "app.ts"),
      [
        "interface Config {",
        "  retries: number;",
        "}",
        "",
        "function hello(config: Config): void {",
        "  console.log(config.retries);",
        "}",
        "",
        "hello({ retries: 1 });",
        "",
      ].join("\n")
    );

    let bodyTypes: string[] = [];

    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "no-hello-fn": {
            description: "Detect a function named hello via the AST",
            async check(ctx) {
              const program = (await ctx.ast("src/app.ts", "typescript")) as {
                type: string;
                body: Array<{
                  type: string;
                  id?: { name?: string };
                  loc?: { start: { line: number } };
                }>;
              };
              bodyTypes = program.body.map((node) => node.type);
              for (const node of program.body) {
                if (
                  node.type === "FunctionDeclaration" &&
                  node.id?.name === "hello"
                ) {
                  ctx.report.violation({
                    message: `Function "${node.id.name}" is banned`,
                    file: "src/app.ts",
                  });
                }
              }
            },
          },
        },
      }
    );

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].error).toBeUndefined();
    expect(result.results[0].violations).toHaveLength(1);
    expect(result.results[0].violations[0].message).toContain("hello");
    // Type-only syntax (the interface) is erased before parsing — only the
    // runtime statements survive in the Program body.
    expect(bodyTypes).toEqual(["FunctionDeclaration", "ExpressionStatement"]);
  });

  test("plausibility guardrail: wrong extension for the language is refused", async () => {
    writeFileSync(join(tempDir, "data.json"), "{}");

    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "json-as-python": {
            description: "Attempt to parse JSON as Python",
            async check(ctx) {
              await ctx.ast("data.json", "python");
            },
          },
        },
      }
    );

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].error).toContain("does not look like python");
  });

  test("sandbox guardrail: paths escaping the project root are refused", async () => {
    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "ast-traversal": {
            description: "Attempt AST parse outside the project",
            async check(ctx) {
              await ctx.ast("../outside.py", "python");
            },
          },
        },
      }
    );

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].error).toContain("escapes project root");
  });

  test("parse failure surfaces as RuleResult.error without breaking the run", async () => {
    writeFileSync(join(tempDir, "src", "broken.ts"), "const = {\n");
    writeFileSync(join(tempDir, "src", "fine.ts"), "export const ok = 1;\n");

    const loaded = makeLoadedAdr(
      { files: ["src/**/*.ts"] },
      {
        rules: {
          "ast-broken": {
            description: "Parse a syntactically broken file",
            async check(ctx) {
              await ctx.ast("src/broken.ts", "typescript");
            },
          },
          "still-runs": {
            description: "Unaffected rule in the same ADR",
            async check(ctx) {
              const matches = await ctx.grep("src/fine.ts", /ok/u);
              if (matches.length === 0) {
                ctx.report.violation({ message: "expected content missing" });
              }
            },
          },
        },
      }
    );

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results).toHaveLength(2);

    const broken = result.results.find((r) => r.ruleId === "ast-broken");
    const healthy = result.results.find((r) => r.ruleId === "still-runs");
    expect(broken?.error).toContain("Failed to parse");
    expect(broken?.error).toContain("src/broken.ts");
    expect(healthy?.error).toBeUndefined();
    expect(healthy?.violations).toHaveLength(0);

    // ARCH-022 failure-visibility contract: a rule error is the exit-code-2
    // category, never a silent pass.
    expect(getExitCode(result)).toBe(2);
  });

  test.skipIf(!pythonInterpreter)(
    "python: rule detects a bare except clause through runChecks",
    async () => {
      writeFileSync(
        join(tempDir, "src", "handler.py"),
        ["try:", "    risky()", "except:", "    pass", ""].join("\n")
      );

      const loaded = makeLoadedAdr(
        {},
        {
          rules: {
            "no-bare-except": {
              description: "Disallow bare except: clauses",
              async check(ctx) {
                const tree = await ctx.ast("src/handler.py", "python");
                const hits: Array<Record<string, unknown>> = [];
                collectPyNodes(
                  tree,
                  (record) =>
                    record._type === "ExceptHandler" && record.type === null,
                  hits
                );
                for (const hit of hits) {
                  ctx.report.violation({
                    message: "Bare except: clause",
                    file: "src/handler.py",
                    line: typeof hit.lineno === "number" ? hit.lineno : 0,
                  });
                }
              },
            },
          },
        }
      );

      const result = await runChecks(tempDir, [loaded]);
      expect(result.results[0].error).toBeUndefined();
      expect(result.results[0].violations).toHaveLength(1);
      expect(result.results[0].violations[0].line).toBe(3);
    }
  );

  test.skipIf(!rubyInterpreter)(
    "ruby: rule detects a method named hello in the sexp through runChecks",
    async () => {
      writeFileSync(
        join(tempDir, "src", "greeter.rb"),
        ["def hello", '  puts "hi"', "end", ""].join("\n")
      );

      const loaded = makeLoadedAdr(
        {},
        {
          rules: {
            "no-hello-method": {
              description: "Detect a method named hello via Ripper sexp",
              async check(ctx) {
                const sexp = await ctx.ast("src/greeter.rb", "ruby");
                expect(Array.isArray(sexp)).toBe(true);
                expect((sexp as unknown[])[0]).toBe("program");
                if (sexpHasIdent(sexp, "hello")) {
                  ctx.report.violation({
                    message: 'Method "hello" is banned',
                    file: "src/greeter.rb",
                  });
                }
              },
            },
          },
        }
      );

      const result = await runChecks(tempDir, [loaded]);
      expect(result.results[0].error).toBeUndefined();
      expect(result.results[0].violations).toHaveLength(1);
    }
  );
});
