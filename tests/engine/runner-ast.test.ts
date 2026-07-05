// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
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
import type {
  PythonAstNode,
  RuleContext,
  RuleSet,
} from "../../src/formats/rules";

// Probe once at load time so interpreter-dependent tests can skipIf cleanly.
const pythonInterpreter = await probeInterpreter(
  interpreterCandidates("python")
);
const rubyInterpreter = await probeInterpreter(interpreterCandidates("ruby"));

/** Recursively collect Python AST nodes matching a predicate. */
function collectPyNodes(
  node: unknown,
  predicate: (n: PythonAstNode) => boolean,
  hits: PythonAstNode[]
): void {
  if (Array.isArray(node)) {
    for (const item of node) collectPyNodes(item, predicate, hits);
    return;
  }
  if (node && typeof node === "object") {
    const n = node as PythonAstNode;
    if (predicate(n)) hits.push(n);
    for (const value of Object.values(n)) {
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
              // No cast: the "typescript" overload narrows to EsTreeProgram, so
              // `.sourceType` / `.body` are typed. A regression to the broad
              // `AstNode` union would fail this file's typecheck.
              const program = await ctx.ast("src/app.ts", "typescript");
              expect(program.sourceType).toBe("module");
              bodyTypes = program.body.map((node) => node.type);
              for (const node of program.body) {
                const id = node.id as { name?: string } | undefined;
                if (
                  node.type === "FunctionDeclaration" &&
                  id?.name === "hello"
                ) {
                  ctx.report.violation({
                    message: `Function "${id.name}" is banned`,
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
                // No cast: the "python" overload narrows to PythonAstModule,
                // so `._type` is typed.
                const tree = await ctx.ast("src/handler.py", "python");
                expect(tree._type).toBe("Module");
                const hits: PythonAstNode[] = [];
                collectPyNodes(
                  tree,
                  (n) => n._type === "ExceptHandler" && n.type === null,
                  hits
                );
                for (const hit of hits) {
                  ctx.report.violation({
                    message: "Bare except: clause",
                    file: "src/handler.py",
                    line: hit.lineno ?? 0,
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
                // No cast: the "ruby" overload narrows to RubyAstNode (an
                // array), so index access is typed.
                const sexp = await ctx.ast("src/greeter.rb", "ruby");
                expect(Array.isArray(sexp)).toBe(true);
                expect(sexp[0]).toBe("program");
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

  test.skipIf(!rubyInterpreter)(
    "ruby: extensionless Rakefile and Gemfile basenames are accepted",
    async () => {
      // "Rakefile"/"Gemfile" carry no extension — plausibility relies on the
      // lowercased-basename membership in RUBY_BASENAMES.
      writeFileSync(join(tempDir, "Rakefile"), "task :default do\nend\n");
      writeFileSync(join(tempDir, "Gemfile"), 'gem "rake"\n');

      const roots: unknown[] = [];
      const loaded = makeLoadedAdr(
        {},
        {
          rules: {
            "ruby-basenames": {
              description: "Parse extensionless Ruby basenames",
              async check(ctx) {
                const rakefile = await ctx.ast("Rakefile", "ruby");
                const gemfile = await ctx.ast("Gemfile", "ruby");
                roots.push(rakefile[0], gemfile[0]);
              },
            },
          },
        }
      );

      const result = await runChecks(tempDir, [loaded]);
      expect(result.results[0].error).toBeUndefined();
      expect(roots).toEqual(["program", "program"]);
    }
  );

  test("tsx/jsx dispatch: JSX parses under the tsx loader and the jsx branch", async () => {
    // The .tsx file mixes type-only syntax with a JSX element — it must go
    // through the `loader: "tsx"` Bun.Transpiler branch to survive both.
    writeFileSync(
      join(tempDir, "src", "App.tsx"),
      "type Props = { name: string };\nexport function App(props: Props) {\n  return <div>{props.name}</div>;\n}\n"
    );
    // The .jsx file exercises the meriyah `jsx: true` branch (no transpile).
    writeFileSync(
      join(tempDir, "src", "widget.jsx"),
      "export const el = <span>hi</span>;\n"
    );

    const programTypes: string[] = [];
    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "jsx-dispatch": {
            description: "Parse .tsx as typescript and .jsx as javascript",
            async check(ctx) {
              const tsx = await ctx.ast("src/App.tsx", "typescript");
              const jsx = await ctx.ast("src/widget.jsx", "javascript");
              programTypes.push(tsx.type, jsx.type);
            },
          },
        },
      }
    );

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].error).toBeUndefined();
    expect(programTypes).toEqual(["Program", "Program"]);
  });

  test(".cjs parses in sloppy script mode while .mjs rejects top-level return", async () => {
    // Node permits a top-level `return` in CommonJS files but never in ESM,
    // so the same source must parse as .cjs and throw as .mjs — proving the
    // .cjs sourceType special-case is real, not incidental.
    const source =
      "if (process.env.ARCHGATE_DISABLED) return;\nmodule.exports = { ok: true };\n";
    writeFileSync(join(tempDir, "src", "legacy.cjs"), source);
    writeFileSync(join(tempDir, "src", "modern.mjs"), source);

    let cjsSourceType = "";
    const loaded = makeLoadedAdr(
      {},
      {
        rules: {
          "cjs-script-mode": {
            description: "Top-level return is legal in .cjs",
            async check(ctx) {
              const program = await ctx.ast("src/legacy.cjs", "javascript");
              cjsSourceType = program.sourceType;
            },
          },
          "mjs-module-mode": {
            description: "Top-level return is illegal in .mjs",
            async check(ctx) {
              await ctx.ast("src/modern.mjs", "javascript");
            },
          },
        },
      }
    );

    const result = await runChecks(tempDir, [loaded]);
    const cjs = result.results.find((r) => r.ruleId === "cjs-script-mode");
    const mjs = result.results.find((r) => r.ruleId === "mjs-module-mode");
    expect(cjs?.error).toBeUndefined();
    expect(cjsSourceType).toBe("script");
    expect(mjs?.error).toContain("Failed to parse");
    expect(mjs?.error).toContain("src/modern.mjs");
  });

  test.skipIf(!pythonInterpreter)(
    "python: -I isolation prevents a project-local ast.py from shadowing the stdlib",
    async () => {
      // Security regression guard: without `-I`, `python -c` prepends the
      // cwd to sys.path, so a hostile project shipping its own ast.py would
      // execute arbitrary code when the serializer does `import ast`.
      const sentinel = join(tempDir, "shadow-sentinel.txt");
      writeFileSync(
        join(tempDir, "ast.py"),
        `open(${JSON.stringify(sentinel.replaceAll("\\", "/"))}, "w").write("x")\nraise SystemExit("SHADOW EXECUTED")\n`
      );
      writeFileSync(join(tempDir, "target.py"), "x = 1\n");

      let treeType = "";
      const loaded = makeLoadedAdr(
        {},
        {
          rules: {
            "shadow-guard": {
              description: "Parse target.py despite a malicious ast.py",
              async check(ctx) {
                const tree = await ctx.ast("target.py", "python");
                treeType = tree._type;
              },
            },
          },
        }
      );

      // Run with cwd inside the hostile project — the realistic `archgate
      // check` invocation — and always restore it afterwards.
      const prevCwd = process.cwd();
      process.chdir(tempDir);
      let result;
      try {
        result = await runChecks(tempDir, [loaded]);
      } finally {
        process.chdir(prevCwd);
      }

      expect(result.results[0].error).toBeUndefined();
      expect(treeType).toBe("Module");
      expect(existsSync(sentinel)).toBe(false);
    }
  );

  test("plausibility guardrail applies per language, not only python", async () => {
    writeFileSync(join(tempDir, "data.json"), "{}");
    const languages = ["ruby", "typescript", "javascript"] as const;

    const loaded = makeLoadedAdr(
      {},
      {
        rules: Object.fromEntries(
          languages.map((language) => [
            `json-as-${language}`,
            {
              description: `Attempt to parse JSON as ${language}`,
              async check(ctx: RuleContext) {
                await ctx.ast("data.json", language);
              },
            },
          ])
        ),
      }
    );

    const result = await runChecks(tempDir, [loaded]);
    const byId = new Map(result.results.map((r) => [r.ruleId, r]));
    for (const language of languages) {
      expect(byId.get(`json-as-${language}`)?.error).toContain(
        `does not look like ${language}`
      );
    }
  });
});
