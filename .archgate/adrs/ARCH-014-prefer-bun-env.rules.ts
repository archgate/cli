/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "no-process-env": {
      description:
        "Source files must use Bun.env instead of process.env for environment variable access",
      async check(ctx) {
        const files = ctx.scopedFiles.filter(
          (f) => !f.includes("tests/") && !f.includes(".archgate/")
        );

        const matches = await Promise.all(
          files.map((file) => ctx.grep(file, /process\.env\b/u))
        );
        for (const fileMatches of matches) {
          for (const m of fileMatches) {
            ctx.report.violation({
              message:
                "Use Bun.env instead of process.env — this is a Bun-native CLI (see ARCH-014).",
              file: m.file,
              line: m.line,
              fix: "Replace process.env.VAR with Bun.env.VAR",
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
