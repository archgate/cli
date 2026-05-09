/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "use-add-option-for-choices": {
      description:
        "Commands with fixed-choice options must use addOption with choices() instead of plain option()",
      severity: "error",
      async check(ctx) {
        const files = ctx.scopedFiles.filter((f) => !f.endsWith("index.ts"));
        // Detect .option() calls whose description enumerates known choice values
        // e.g. "editor integration to configure (claude, cursor, vscode, copilot)"
        // or   "ADR domain: backend, frontend, data, architecture, general"
        const matches = await Promise.all(
          files.map((file) =>
            ctx.grep(
              file,
              /\.option\(\s*["']--\w+\s+<\w+>["'],\s*["'][^"']*(?:claude.*cursor|backend.*frontend)[^"']*["']/u
            )
          )
        );
        for (const fileMatches of matches) {
          for (const m of fileMatches) {
            ctx.report.violation({
              message:
                "Use new Option().choices() with .addOption() instead of .option() for fixed-choice options",
              file: m.file,
              line: m.line,
              fix: "Replace .option() with new Option(...).choices([...] as const) and register via .addOption()",
            });
          }
        }
      },
    },
    "use-add-option-for-arg-parser": {
      description:
        "Options with custom parsers must use addOption with argParser() instead of passing a parser to option()",
      severity: "error",
      async check(ctx) {
        const files = ctx.scopedFiles.filter((f) => !f.endsWith("index.ts"));
        // Detect .option() calls that pass a function as the third argument
        // e.g. .option("--max-entries <n>", "...", parseInt)
        const matches = await Promise.all(
          files.map((file) =>
            ctx.grep(
              file,
              /\.option\(\s*["']--\w+\s+<\w+>["'],\s*["'][^"']*["'],\s*(?:parseInt|parseFloat|\()/u
            )
          )
        );
        for (const fileMatches of matches) {
          for (const m of fileMatches) {
            ctx.report.violation({
              message:
                "Use new Option().argParser() with .addOption() instead of passing a parser to .option()",
              file: m.file,
              line: m.line,
              fix: "Replace .option() with new Option(...).argParser((val) => ...) and register via .addOption()",
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
