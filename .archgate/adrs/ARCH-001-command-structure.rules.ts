/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "register-function-export": {
      description: "Command files must export a register*Command function",
      async check(ctx) {
        const files = ctx.scopedFiles.filter((f) => !f.endsWith("index.ts"));
        const checks = files.map(async (file) => {
          const content = await ctx.readFile(file);
          if (!/export\s+function\s+register\w+Command/u.test(content)) {
            ctx.report.violation({
              message: "Command file must export a register*Command function",
              file,
            });
          }
        });
        await Promise.all(checks);
      },
    },
    "no-business-logic": {
      description: "Command files should not contain business logic patterns",
      severity: "error",
      async check(ctx) {
        const files = ctx.scopedFiles.filter((f) => !f.endsWith("index.ts"));
        const matches = await Promise.all(
          files.map((file) =>
            ctx.grep(
              file,
              /\.(parse|match|replace|split)\(.*\).*\.(parse|match|replace|split)\(/u
            )
          )
        );
        for (const fileMatches of matches) {
          for (const m of fileMatches) {
            ctx.report.violation({
              message:
                "Complex data transformations should be in helpers, not command files",
              file: m.file,
              line: m.line,
              fix: "Move transformation logic to a helper in src/helpers/ or src/formats/",
            });
          }
        }
      },
    },
    "no-top-level-await-in-entry": {
      description:
        "src/cli.ts must not use top-level await (bun build --compile --bytecode rejects it)",
      severity: "error",
      async check(ctx) {
        // The CLI entry point is the only file compiled with --bytecode, so the
        // top-level-await ban applies specifically to it. Read directly rather
        // than via scopedFiles (which is scoped to src/commands/**). `bun run
        // build:check` is the authoritative backstop; this rule is a fast,
        // local early-warning that does not require a full compile.
        let content: string;
        try {
          content = await ctx.readFile("src/cli.ts");
        } catch {
          return;
        }

        const awaitWord = /\bawait\b/u;
        const lines = content.split("\n");
        for (const [index, line] of lines.entries()) {
          // Lines indented >= 2 spaces are inside a function body (2-space
          // indentation) and are therefore not top-level.
          const leading = line.length - line.trimStart().length;
          if (leading >= 2) continue;

          const trimmed = line.trimStart();
          if (
            trimmed.startsWith("//") ||
            trimmed.startsWith("*") ||
            trimmed.startsWith("/*")
          ) {
            continue;
          }

          if (awaitWord.test(line)) {
            ctx.report.violation({
              message:
                "Top-level await in src/cli.ts breaks `bun build --compile --bytecode`",
              file: "src/cli.ts",
              line: index + 1,
              fix: "Move async bootstrap logic into `async function main()` and call `main().catch(...)`",
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
