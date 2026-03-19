/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "register-function-export": {
      description: "Command files must export a register*Command function",
      async check(ctx) {
        const files = ctx.scopedFiles.filter((f) => !f.endsWith("index.ts"));
        const checks = files.map(async (file) => {
          const content = await ctx.readFile(file);
          if (!/export\s+function\s+register\w+Command/.test(content)) {
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
              /\.(parse|match|replace|split)\(.*\).*\.(parse|match|replace|split)\(/
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
  },
} satisfies RuleSet;
