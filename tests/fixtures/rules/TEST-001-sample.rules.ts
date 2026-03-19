import type { RuleSet } from "../../../src/formats/rules";

export default {
  rules: {
    "no-todo-comments": {
      description: "Disallow TODO comments in source files",
      severity: "warning",
      async check(ctx) {
        const matches = await Promise.all(
          ctx.scopedFiles.map((file) => ctx.grep(file, /\/\/\s*TODO/i))
        );
        for (const fileMatches of matches) {
          for (const match of fileMatches) {
            ctx.report.warning({
              message: `Found TODO comment: ${match.content.trim()}`,
              file: match.file,
              line: match.line,
            });
          }
        }
      },
    },
    "no-console-log": {
      description: "Disallow console.log in source files",
      async check(ctx) {
        const matches = await Promise.all(
          ctx.scopedFiles.map((file) => ctx.grep(file, /console\.log\(/))
        );
        for (const fileMatches of matches) {
          for (const match of fileMatches) {
            ctx.report.violation({
              message: "Use logInfo/logError instead of console.log",
              file: match.file,
              line: match.line,
              fix: "Replace console.log with the appropriate log helper",
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
