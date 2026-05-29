/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "no-npm-main-field": {
      description:
        "Root package.json must not declare a `main` field — npm always publishes it, bundling the CLI into the thin shim",
      severity: "error",
      async check(ctx) {
        let pkgJson: Record<string, unknown>;
        try {
          pkgJson = (await ctx.readJSON("package.json")) as Record<
            string,
            unknown
          >;
        } catch {
          return;
        }

        if ("main" in pkgJson) {
          ctx.report.violation({
            message: `package.json declares a "main" field ("${String(pkgJson.main)}") — npm always includes it in the published tarball, bundling the CLI entry point into the thin shim`,
            file: "package.json",
            fix: 'Remove the "main" field; the npm package exposes only bin/archgate.cjs and sub-path exports (e.g. "./rules")',
          });
        }
      },
    },
  },
} satisfies RuleSet;
