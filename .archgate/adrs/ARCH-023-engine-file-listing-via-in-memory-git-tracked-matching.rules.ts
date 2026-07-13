/// <reference path="../rules.d.ts" />

/**
 * ARCH-023: file listing in src/engine/ must match in memory against the
 * git-tracked set. Bun.Glob scanning is fallback-only and confined to the
 * two modules that implement the fallback.
 */
const SCAN_ALLOWED_FILES = new Set([
  "src/engine/glob-utils.ts",
  "src/engine/git-files.ts",
]);

export default {
  rules: {
    "scan-confined-to-fallback-modules": {
      description:
        "Bun.Glob#scan() call sites in src/engine/ are confined to glob-utils.ts and git-files.ts — everywhere else must use in-memory matching (listMatchingFiles/matchTrackedFiles)",
      severity: "error",
      async check(ctx) {
        const files = ctx.scopedFiles.filter(
          (f) => f.endsWith(".ts") && !SCAN_ALLOWED_FILES.has(f)
        );

        // Same call-site detection as ARCH-020's glob-scan-dot rule: capture
        // the argument list of each scan call. `[^)]` spans newlines, so
        // multi-line option objects are covered.
        const callPattern = /\.scan\(([^)]*)\)/gu;

        const checks = files.map(async (file) => {
          let content: string;
          try {
            content = await ctx.readFile(file);
          } catch {
            return;
          }

          for (const match of content.matchAll(callPattern)) {
            const offset = match.index ?? 0;
            const line = content.slice(0, offset).split("\n").length;

            ctx.report.violation({
              message:
                "Bun.Glob#scan() in src/engine/ is fallback-only and confined to glob-utils.ts/git-files.ts — walking the filesystem per rule re-introduces the traversal cost ARCH-023 eliminates",
              file,
              line,
              fix: "Use listMatchingFiles() or matchTrackedFiles() from src/engine/glob-utils.ts; if a genuine new fallback is required, update ARCH-023 and its allowlist with maintainer approval",
            });
          }
        });
        await Promise.all(checks);
      },
    },
  },
} satisfies RuleSet;
