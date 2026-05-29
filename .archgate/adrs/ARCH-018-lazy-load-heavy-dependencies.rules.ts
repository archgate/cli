/// <reference path="../rules.d.ts" />

// Dependencies heavy enough that their parse cost should never be paid by
// invocations that don't use them. Value-level static imports of these are
// banned; `import type` is fine (erased at compile time). See ARCH-018.
const HEAVY_MODULES = ["inquirer", "posthog-node", "@sentry/"];

export default {
  rules: {
    "no-static-heavy-import": {
      description:
        "Heavy dependencies (inquirer, posthog-node, @sentry/*) must be loaded via dynamic import(), not statically imported for their value",
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
            // Only consider static `import ... from "..."` statements.
            const fromMatch = line.match(
              /^\s*import\s+(?<clause>[^;]*?)\s+from\s+["'](?<source>[^"']+)["']/u
            );
            if (!fromMatch?.groups) continue;

            const { clause, source } = fromMatch.groups;

            // `import type ...` is erased at runtime — always allowed.
            if (/^type\b/u.test(clause.trim())) continue;

            const isHeavy = HEAVY_MODULES.some((mod) =>
              mod.endsWith("/") ? source.startsWith(mod) : source === mod
            );
            if (!isHeavy) continue;

            ctx.report.violation({
              message: `Static value import of heavy module "${source}" forces every CLI invocation to parse it`,
              file,
              line: index + 1,
              fix: `Load it lazily: \`const { default: x } = await import("${source}")\` at the point of use (or use \`import type\` for type-only references)`,
            });
          }
        });
        await Promise.all(checks);
      },
    },
  },
} satisfies RuleSet;
