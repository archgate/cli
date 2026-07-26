/// <reference path="../rules.d.ts" />

/**
 * .oxlintrc.json is JSONC (whole-line `//` comments, no trailing inline
 * comments in this project's file) — Bun.file().json() / ctx.readJSON()
 * both use strict JSON.parse and reject it. Strip comment-only lines before
 * parsing.
 */
function parseJsonc(text: string): unknown {
  const stripped = text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  return JSON.parse(stripped);
}

/** Narrow the unknown-typed .oxlintrc.json read down to the one field this rule checks. */
function hasTypeAwareEnabled(config: unknown): boolean {
  if (typeof config !== "object" || config === null) return false;
  if (!("options" in config)) return false;
  const options = config.options;
  if (typeof options !== "object" || options === null) return false;
  if (!("typeAware" in options)) return false;
  return options.typeAware === true;
}

export default {
  rules: {
    "type-aware-linting-configured": {
      description:
        "Root .oxlintrc.json must have options.typeAware enabled, and package.json must pin typescript and oxlint-tsgolint as devDependencies",
      async check(ctx) {
        let oxlintConfig: unknown;
        try {
          oxlintConfig = parseJsonc(await ctx.readFile(".oxlintrc.json"));
        } catch {
          ctx.report.violation({
            message: "Root .oxlintrc.json is missing or not valid JSON.",
            file: ".oxlintrc.json",
            fix: 'Restore .oxlintrc.json with "options": { "typeAware": true } at the top level (see ARCH-026).',
          });
          return;
        }

        if (!hasTypeAwareEnabled(oxlintConfig)) {
          ctx.report.violation({
            message:
              'Type-aware linting is disabled — .oxlintrc.json must set "options": { "typeAware": true } at the root (per ARCH-026). oxlint only honors this option in the root config file.',
            file: ".oxlintrc.json",
            fix: 'Add "options": { "typeAware": true } at the top level of .oxlintrc.json.',
          });
        }

        let pkg: PackageJson;
        try {
          pkg = await ctx.readJSON("package.json");
        } catch {
          ctx.report.violation({
            message: "package.json is missing or not valid JSON.",
            file: "package.json",
            fix: "Restore package.json.",
          });
          return;
        }

        const devDeps = pkg.devDependencies ?? {};
        for (const dep of ["typescript", "oxlint-tsgolint"]) {
          if (!(dep in devDeps)) {
            ctx.report.violation({
              message: `package.json devDependencies is missing "${dep}" — type-aware linting requires an explicit, exact-pinned devDependency (per ARCH-026), not a transitively-resolved version.`,
              file: "package.json",
              fix: `Add "${dep}" to devDependencies, pinned to a version compatible with the other package (oxlint-tsgolint's version tracks the typescript release it supports).`,
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
