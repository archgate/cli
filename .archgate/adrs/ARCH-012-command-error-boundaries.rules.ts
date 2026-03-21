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
          const hasAsyncAction = /\.action\(\s*async\s/.test(content);
          if (!hasAsyncAction) return;

          // Check if the async action body contains a try block
          // Match: .action(async (...) => { ... try { ... } ... })
          const hasTryCatch = /\.action\(\s*async\s[\s\S]*?\btry\s*\{/.test(
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
  },
} satisfies RuleSet;
