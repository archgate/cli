/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "prefer-bun-json": {
      description:
        "Use Bun.file().json() instead of JSON.parse(await Bun.file().text())",
      severity: "warning",
      async check(ctx) {
        const files = ctx.scopedFiles.filter(
          (f) => !f.includes("tests/") && !f.includes(".archgate/")
        );

        const matches = await Promise.all(
          files.map((file) =>
            ctx.grep(file, /JSON\.parse\(\s*await\s+Bun\.file/)
          )
        );
        for (const fileMatches of matches) {
          for (const m of fileMatches) {
            ctx.report.warning({
              message:
                "Use Bun.file(path).json() instead of JSON.parse(await Bun.file(path).text())",
              file: m.file,
              line: m.line,
              fix: "Replace JSON.parse(await Bun.file(path).text()) with await Bun.file(path).json()",
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
