import { defineRules } from "../../src/formats/rules";

export default defineRules({
  "use-add-option-for-choices": {
    description:
      "Commands with fixed-choice options should use addOption with choices() instead of plain option()",
    severity: "warning",
    async check(ctx) {
      const files = ctx.scopedFiles.filter((f) => !f.endsWith("index.ts"));
      const matches = await Promise.all(
        files.map((file) =>
          ctx.grep(
            file,
            /\.option\(\s*["']--\w+\s+<\w+>["'],\s*["'][^"']*["'],\s*["'](claude|cursor|vscode|copilot)["']\)/
          )
        )
      );
      for (const fileMatches of matches) {
        for (const m of fileMatches) {
          ctx.report.warning({
            message:
              "Use new Option().choices() with .addOption() instead of .option() for fixed-choice options",
            file: m.file,
            line: m.line,
            fix: "Replace .option() with new Option(...).choices([...] as const).default(... as const) and register via .addOption()",
          });
        }
      }
    },
  },
});
