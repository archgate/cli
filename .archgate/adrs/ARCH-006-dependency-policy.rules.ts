/// <reference path="../rules.d.ts" />

const APPROVED_DEPS = [
  "@commander-js/extra-typings",
  "inquirer",
  "@modelcontextprotocol/sdk",
  "zod",
];

export default {
  rules: {
    "no-unapproved-deps": {
      description: "Production dependencies must be on the approved list",
      async check(ctx) {
        let pkg: { dependencies?: Record<string, string> };
        try {
          pkg = (await ctx.readJSON("package.json")) as typeof pkg;
        } catch {
          return; // No package.json — nothing to check
        }

        const deps = Object.keys(pkg.dependencies ?? {});
        for (const dep of deps) {
          if (!APPROVED_DEPS.includes(dep)) {
            ctx.report.violation({
              message: `Unapproved production dependency: "${dep}". Approved: ${APPROVED_DEPS.join(", ")}`,
              file: "package.json",
              fix: `Either add "${dep}" to the approved list in ARCH-006 or move it to devDependencies`,
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
