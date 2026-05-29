/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "glob-scan-dot": {
      description:
        "Bun.Glob#scan() calls must pass { dot: true } so dot-prefixed dirs (.github, .husky, ...) are traversed",
      severity: "error",
      async check(ctx) {
        const files = ctx.scopedFiles.filter((f) => f.endsWith(".ts"));

        // Capture the argument list of each `.scan( ... )` call. The character
        // class `[^)]` spans newlines, so multi-line option objects are
        // covered, as long as the args contain no nested `)` (true for glob
        // option objects: `{ cwd, dot: true }`).
        const callPattern = /\.scan\(([^)]*)\)/gu;

        const checks = files.map(async (file) => {
          let content: string;
          try {
            content = await ctx.readFile(file);
          } catch {
            return;
          }

          for (const match of content.matchAll(callPattern)) {
            const args = match[1];
            if (/\bdot\s*:/u.test(args)) continue;

            const offset = match.index ?? 0;
            const line = content.slice(0, offset).split("\n").length;

            ctx.report.violation({
              message:
                "Bun.Glob#scan() must pass { dot: true } or it silently skips dot-prefixed directories on Windows",
              file,
              line,
              fix: "Add `dot: true` to the scan options, e.g. `glob.scan({ cwd, dot: true })`",
            });
          }
        });
        await Promise.all(checks);
      },
    },
  },
} satisfies RuleSet;
