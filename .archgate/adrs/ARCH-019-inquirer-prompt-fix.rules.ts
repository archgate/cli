/// <reference path="../rules.d.ts" />

function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*")
  );
}

export default {
  rules: {
    "inquirer-prompt-wrapped": {
      description:
        "Every inquirer.prompt() call must be wrapped in withPromptFix() (Windows newline corruption)",
      severity: "error",
      async check(ctx) {
        const files = ctx.scopedFiles.filter((f) => f.endsWith(".ts"));

        const checks = files.map(async (file) => {
          let content: string;
          try {
            content = await ctx.readFile(file);
          } catch {
            return;
          }
          const lines = content.split("\n");

          for (const [index, line] of lines.entries()) {
            if (isCommentLine(line)) continue;
            if (!line.includes("inquirer.prompt(")) continue;

            // Allowed if wrapped on the same line, or if the immediately
            // preceding non-blank line opens the wrapper (the common
            // `withPromptFix(() =>\n  inquirer.prompt([` shape).
            if (line.includes("withPromptFix")) continue;

            let prevNonBlank = "";
            for (let i = index - 1; i >= 0; i--) {
              if (lines[i].trim() !== "") {
                prevNonBlank = lines[i];
                break;
              }
            }
            if (prevNonBlank.includes("withPromptFix")) continue;

            ctx.report.violation({
              message:
                "inquirer.prompt() must be wrapped in withPromptFix() or it corrupts newline handling on Windows",
              file,
              line: index + 1,
              fix: "Wrap the call: `await withPromptFix(() => inquirer.prompt([...]))` (import from src/helpers/prompt.ts)",
            });
          }
        });
        await Promise.all(checks);
      },
    },
  },
} satisfies RuleSet;
