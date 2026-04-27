/// <reference path="../rules.d.ts" />

/**
 * Matches `uses:` lines referencing third-party actions or reusable workflows.
 * Captures: owner/action@ref (ignoring local refs like `./.github/...` and
 * docker refs like `docker://...`).
 */
const USES_PATTERN = /uses:\s+(?!\.\/|docker:\/\/)(\S+@\S+)/g;

/**
 * A valid pinned reference: 40 hex characters (full SHA), optionally followed
 * by a version comment.
 */
const PINNED_SHA_PATTERN = /^.+@[0-9a-f]{40}\b/;

export default {
  rules: {
    "no-unpinned-actions": {
      description:
        "Third-party GitHub Actions and reusable workflows must be pinned by full commit SHA",
      async check(ctx) {
        const matches = await ctx.grepFiles(
          USES_PATTERN,
          ".github/workflows/*.yml"
        );

        for (const m of matches) {
          // Extract the full `uses:` value from the matched line
          const usesMatch = m.content.match(
            /uses:\s+(?!\.\/|docker:\/\/)(\S+@\S+)/
          );
          if (!usesMatch) continue;

          const ref = usesMatch[1];
          if (!PINNED_SHA_PATTERN.test(ref)) {
            ctx.report.violation({
              message: `Unpinned action reference: "${ref}". Pin by full 40-character commit SHA with a version comment (e.g., \`actions/checkout@<sha> # v6\`).`,
              file: m.file,
              line: m.line,
              fix: `Replace the tag/branch reference with the commit SHA. Use: gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq '.object.sha'`,
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
