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

/**
 * Extract the package name from a node_modules package.json path.
 * Handles both regular (node_modules/foo/package.json) and scoped
 * (node_modules/@scope/foo/package.json) packages.
 */
function extractPackageName(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/");
  const nmIdx = parts.lastIndexOf("node_modules");
  if (nmIdx === -1) return path;
  const afterNm = parts.slice(nmIdx + 1);
  // Scoped package: @scope/name
  if (afterNm[0]?.startsWith("@") && afterNm.length >= 2) {
    return `${afterNm[0]}/${afterNm[1]}`;
  }
  return afterNm[0] ?? path;
}

export default {
  rules: {
    "no-copyleft-deps": {
      description:
        "All dependencies (including transitive) must use Apache-2.0-compatible (permissive) licenses",
      async check(ctx) {
        // Scan ALL packages in node_modules — direct AND transitive.
        // Brace expansion covers both regular (zod) and scoped (@sentry/node-core) packages.
        const pkgFiles = await ctx.glob("node_modules/{*,@*/*}/package.json");

        const depResults = await Promise.all(
          pkgFiles.map(async (pkgPath) => {
            try {
              const depPkg = await ctx.readJSON(pkgPath);
              const name = extractPackageName(pkgPath);
              return {
                dep: name,
                license: depPkg.license as string | undefined,
              };
            } catch {
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
              fix: `Remove "${result.dep}" or find an alternative with a permissive license. See LEGAL-002 for the approved license list.`,
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
