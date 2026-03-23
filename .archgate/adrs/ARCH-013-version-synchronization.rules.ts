/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "docs-version-sync": {
      description:
        "softwareVersion in docs/astro.config.mjs must match package.json version",
      severity: "error",
      async check(ctx) {
        const pkgJson = await ctx.readJSON("package.json");
        if (!pkgJson.version) return;

        let astroConfig: string;
        try {
          astroConfig = await ctx.readFile("docs/astro.config.mjs");
        } catch {
          // docs/astro.config.mjs may not exist in all contexts
          return;
        }

        const match = astroConfig.match(/softwareVersion:\s*"([^"]+)"/);
        if (!match) return;

        const docsVersion = match[1];
        if (docsVersion !== pkgJson.version) {
          ctx.report.violation({
            message: `docs/astro.config.mjs softwareVersion "${docsVersion}" does not match package.json version "${pkgJson.version}"`,
            file: "docs/astro.config.mjs",
            fix: `Update softwareVersion to "${pkgJson.version}" in docs/astro.config.mjs`,
          });
        }
      },
    },
    "optional-deps-version-sync": {
      description:
        "optionalDependencies versions must match package.json version",
      severity: "error",
      async check(ctx) {
        const pkgJson = await ctx.readJSON("package.json");
        if (!pkgJson.version || !pkgJson.optionalDependencies) return;

        for (const [dep, depVersion] of Object.entries(
          pkgJson.optionalDependencies
        )) {
          if (depVersion !== pkgJson.version) {
            ctx.report.violation({
              message: `optionalDependencies "${dep}" version "${depVersion}" does not match package.json version "${pkgJson.version}"`,
              file: "package.json",
              fix: `Update ${dep} to "${pkgJson.version}" in optionalDependencies (normally handled by .simple-release.js during release)`,
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
