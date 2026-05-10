/// <reference path="../rules.d.ts" />

const ALLOWED_LICENSES = new Set([
  "MIT",
  "Apache-2.0",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
  "BlueOak-1.0.0",
  "CC-BY-4.0",
  "CC-BY-3.0",
  "Python-2.0",
  "(MIT OR Apache-2.0)",
  "MIT OR Apache-2.0",
  "(MIT AND Zlib)",
  "(BSD-2-Clause OR MIT OR Apache-2.0)",
  "(MIT OR CC0-1.0)",
  "BlueOak-1.0.0 OR MIT OR Apache-2.0",
]);

function isAllowed(license: string | undefined): boolean {
  if (!license) return false;
  if (ALLOWED_LICENSES.has(license)) return true;

  const normalized = license.trim().replace(/^\(/u, "").replace(/\)$/u, "");
  if (ALLOWED_LICENSES.has(normalized)) return true;
  if (ALLOWED_LICENSES.has(`(${normalized})`)) return true;

  // OR expressions: at least one alternative must be allowed
  if (normalized.includes(" OR ")) {
    return normalized.split(" OR ").some((l) => ALLOWED_LICENSES.has(l.trim()));
  }

  return false;
}

export default {
  rules: {
    "no-copyleft-deps": {
      description:
        "All dependencies must use Apache-2.0-compatible (permissive) licenses",
      async check(ctx) {
        let pkg;
        try {
          pkg = await ctx.readJSON("package.json");
        } catch {
          return;
        }

        const allDeps = [
          ...Object.keys(pkg.dependencies ?? {}),
          ...Object.keys(pkg.devDependencies ?? {}),
        ];

        const depResults = await Promise.all(
          allDeps.map(async (dep) => {
            try {
              const depPkg = await ctx.readJSON(
                `node_modules/${dep}/package.json`
              );
              return { dep, license: depPkg.license as string | undefined };
            } catch {
              // Scoped packages or missing — skip (covered by full scan)
              return null;
            }
          })
        );

        for (const result of depResults) {
          if (result === null) continue;
          if (!isAllowed(result.license)) {
            ctx.report.violation({
              message: `Dependency "${result.dep}" has disallowed license: "${result.license ?? "(none)"}". Only permissive licenses (MIT, Apache-2.0, ISC, BSD, etc.) are allowed.`,
              file: "package.json",
              fix: `Remove "${result.dep}" or find an alternative with a permissive license. Run \`bun run license:check\` for full details.`,
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
