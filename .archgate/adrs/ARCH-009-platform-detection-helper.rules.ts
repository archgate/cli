/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "no-direct-process-platform": {
      description:
        "Platform detection must use src/helpers/platform.ts, not process.platform directly",
      async check(ctx) {
        const files = ctx.scopedFiles.filter(
          (f) =>
            !f.includes("tests/") &&
            !f.includes(".archgate/") &&
            !f.endsWith("src/helpers/platform.ts")
        );

        const matches = await Promise.all(
          files.map((file) => ctx.grep(file, /process\.platform/u))
        );
        for (const fileMatches of matches) {
          for (const m of fileMatches) {
            ctx.report.violation({
              message:
                "Do not access process.platform directly — use isWindows(), isMacOS(), isLinux(), or getPlatformInfo() from src/helpers/platform.ts instead.",
              file: m.file,
              line: m.line,
              fix: 'Import { isWindows } from "../helpers/platform" (or the appropriate helper) and use it instead of process.platform',
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
