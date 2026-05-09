/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "no-process-cwd-for-project-root": {
      description:
        "Command files must use findProjectRoot() instead of process.cwd() for project root resolution",
      severity: "error",
      async check(ctx) {
        // init.ts is exempt — it creates the project, so no root exists yet
        const files = ctx.scopedFiles.filter(
          (f) =>
            f.includes("commands/") &&
            !f.endsWith("init.ts") &&
            !f.endsWith("index.ts")
        );

        const checks = files.map(async (file) => {
          const matches = await ctx.grep(file, /process\.cwd\(\)/u);
          for (const m of matches) {
            // Allow process.cwd() as a fallback after findProjectRoot()
            // e.g. findProjectRoot() ?? process.cwd()
            if (m.content.includes("findProjectRoot")) continue;

            ctx.report.violation({
              message:
                "Use findProjectRoot() from helpers/paths.ts instead of process.cwd() for project root resolution",
              file: m.file,
              line: m.line,
              fix: "Import { findProjectRoot } from '../helpers/paths' and use findProjectRoot()",
            });
          }
        });
        await Promise.all(checks);
      },
    },
  },
} satisfies RuleSet;
