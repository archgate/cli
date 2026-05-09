/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "prefer-bun-json": {
      description:
        "Use Bun.file().json() instead of JSON.parse with Bun.file().text()",
      severity: "warning",
      async check(ctx) {
        const files = ctx.scopedFiles.filter(
          (f) => !f.includes("tests/") && !f.includes(".archgate/")
        );

        // Pattern 1: single-expression JSON.parse(await Bun.file(...).text())
        const inlineMatches = await Promise.all(
          files.map((file) =>
            ctx.grep(file, /JSON\.parse\(\s*await\s+Bun\.file/u)
          )
        );
        for (const fileMatches of inlineMatches) {
          for (const m of fileMatches) {
            ctx.report.warning({
              message:
                "Use Bun.file(path).json() instead of JSON.parse(await Bun.file(path).text())",
              file: m.file,
              line: m.line,
              fix: "Replace with await Bun.file(path).json()",
            });
          }
        }

        // Pattern 2: two-line pattern — Bun.file().text() assigned to a
        // variable that is then passed to JSON.parse on a subsequent line.
        // Detect files that use both Bun.file().text() and JSON.parse.
        await Promise.all(
          files.map(async (file) => {
            const content = await ctx.readFile(file);
            if (!content.includes("JSON.parse")) return;

            const textCalls = await ctx.grep(
              file,
              /Bun\.file\([^)]+\)\.text\(\)/u
            );
            if (textCalls.length === 0) return;

            // If JSON.parse appears after a Bun.file().text() call,
            // it's likely parsing the result of that read.
            for (const m of textCalls) {
              ctx.report.warning({
                message:
                  "Bun.file().text() followed by JSON.parse — use Bun.file().json() instead",
                file: m.file,
                line: m.line,
                fix: "Replace .text() + JSON.parse() with .json()",
              });
            }
          })
        );
      },
    },
  },
} satisfies RuleSet;
