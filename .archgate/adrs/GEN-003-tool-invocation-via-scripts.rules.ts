/// <reference path="../rules.d.ts" />

// Lint/format tools that MUST only be invoked via package.json scripts
// (`bun run lint` / `bun run format`), never directly with bunx/npx. Non-lint
// tools (e.g. astro) are intentionally excluded so `bunx --bun astro` stays
// legal. See GEN-003.
const LINT_FORMAT_TOOLS = ["prettier", "oxfmt", "oxlint", "eslint", "biome"];

export default {
  rules: {
    "no-direct-lint-format-invocation": {
      description:
        "Lint/format tools must be invoked via package.json scripts, not bunx/npx",
      severity: "error",
      async check(ctx) {
        // Build an alternation like (prettier|oxfmt|oxlint|eslint|biome).
        const toolGroup = LINT_FORMAT_TOOLS.join("|");
        // Match `bunx <tool>` or `npx <tool>`, allowing flags between the
        // runner and the tool name (e.g. `bunx --bun oxfmt`).
        const pattern = new RegExp(
          String.raw`\b(?:bunx|npx)\b(?:\s+--?\S+)*\s+(?:${toolGroup})\b`,
          "u"
        );

        // Scope: CI workflows + package.json only. Markdown is excluded so this
        // ADR's own prohibited-example prose is not flagged.
        const targets = [
          ...(await ctx.glob(".github/workflows/*.yml")),
          ...(await ctx.glob(".github/workflows/*.yaml")),
          "package.json",
        ];

        const checks = targets.map(async (file) => {
          const matches = await ctx.grep(file, pattern);
          for (const m of matches) {
            ctx.report.violation({
              message: `Direct lint/format tool invocation ("${m.content.trim()}") is prohibited`,
              file: m.file,
              line: m.line,
              fix: "Invoke the tool via a package.json script instead (e.g. `bun run lint`, `bun run format`)",
            });
          }
        });
        await Promise.all(checks);
      },
    },
    "no-bare-bun-test-in-ci": {
      description:
        "CI workflows must run tests via `bun run test`, not bare `bun test`",
      severity: "error",
      async check(ctx) {
        // `\bbun test\b` matches `bun test ...` but NOT `bun run test ...`
        // (the literal substring "bun test" is absent from "bun run test").
        const pattern = /\bbun test\b/u;

        const targets = [
          ...(await ctx.glob(".github/workflows/*.yml")),
          ...(await ctx.glob(".github/workflows/*.yaml")),
        ];

        const checks = targets.map(async (file) => {
          const matches = await ctx.grep(file, pattern);
          for (const m of matches) {
            ctx.report.violation({
              message:
                "Bare `bun test` in CI skips package.json script flags (e.g. --timeout)",
              file: m.file,
              line: m.line,
              fix: "Use `bun run test` (append extra flags after it, e.g. `bun run test --coverage`)",
            });
          }
        });
        await Promise.all(checks);
      },
    },
  },
} satisfies RuleSet;
