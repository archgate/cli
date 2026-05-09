/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "async-action-error-boundary": {
      description:
        "Async command actions must include try-catch error boundaries",
      severity: "warning",
      async check(ctx) {
        // Only check non-index command files
        const files = ctx.scopedFiles.filter(
          (f) => f.includes("commands/") && !f.endsWith("index.ts")
        );

        const checks = files.map(async (file) => {
          const content = await ctx.readFile(file);

          // Find async action callbacks
          const hasAsyncAction = /\.action\(\s*async\s/u.test(content);
          if (!hasAsyncAction) return;

          // Check if the async action body contains a try block
          // Match: .action(async (...) => { ... try { ... } ... })
          const hasTryCatch = /\.action\(\s*async\s[\s\S]*?\btry\s*\{/u.test(
            content
          );

          if (!hasTryCatch) {
            ctx.report.warning({
              message:
                "Async command action should include a try-catch error boundary",
              file,
              fix: "Wrap the action body in try { ... } catch (err) { logError(...); process.exit(1); }",
            });
          }
        });
        await Promise.all(checks);
      },
    },
    "exit-prompt-error-rethrow": {
      description:
        "Catch blocks in async command actions must re-throw ExitPromptError for proper Ctrl+C handling (exit 130)",
      async check(ctx) {
        // Only check non-index command files that have async actions
        const files = ctx.scopedFiles.filter(
          (f) => f.includes("commands/") && !f.endsWith("index.ts")
        );

        const checks = files.map(async (file) => {
          const content = await ctx.readFile(file);

          // Only check files with async actions that have try-catch
          const hasAsyncActionWithTryCatch =
            /\.action\(\s*async\s[\s\S]*?\btry\s*\{/u.test(content);
          if (!hasAsyncActionWithTryCatch) return;

          // Check for the ExitPromptError re-throw pattern anywhere in the file.
          // The canonical pattern is:
          //   if (err instanceof Error && err.name === "ExitPromptError") throw err;
          const hasExitPromptRethrow = /ExitPromptError/u.test(content);

          if (!hasExitPromptRethrow) {
            ctx.report.violation({
              message:
                "Catch block in async command action must re-throw ExitPromptError so Ctrl+C exits with code 130 instead of code 1",
              file,
              fix: 'Add `if (err instanceof Error && err.name === "ExitPromptError") throw err;` as the first line in the catch block',
            });
          }
        });
        await Promise.all(checks);
      },
    },
  },
} satisfies RuleSet;
