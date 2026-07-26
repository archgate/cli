/// <reference path="../rules.d.ts" />

/**
 * Exact filenames permitted at the repository root — see GEN-005's Decision
 * for the criteria each entry satisfies. Adding a root file requires adding
 * it here in the same change, per GEN-005's Do's.
 */
const ALLOWED_ROOT_FILES = new Set([
  // Package manifests / lockfiles
  "package.json",
  "bun.lock",
  "bunfig.toml",

  // Tool configuration required at the root by convention
  "tsconfig.json",
  "knip.json",
  ".oxlintrc.json",
  ".oxfmtrc.json",
  ".commitlintrc.json",
  ".prototools",
  ".simple-release.js",
  "renovate.json",
  "zizmor.yml",

  // Governance / community-health documents
  "README.md",
  "LICENSE.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "MAINTAINERS.md",
  "ROADMAP.md",
  "APPROVAL_POLICY.md",
  "ASSURANCE-CASE.md",
  "CLAUDE.md",

  // Git / npm mechanism dotfiles
  ".gitignore",
  ".gitattributes",
  ".npmignore",
  ".githooks",

  // Published install entry points
  "install.sh",
  "install.ps1",
]);

export default {
  rules: {
    "no-unlisted-root-files": {
      description:
        "Repository root must contain only files on the GEN-005 allowlist",
      severity: "error",
      async check(ctx) {
        // `*` never crosses `/`, and ctx.glob() matches in-memory against the
        // tracked-plus-untracked-not-gitignored set (ARCH-023) — so this sees
        // only root-level files, and sees a scratch file as soon as it exists
        // and is not gitignored, before it is ever staged or committed.
        const rootFiles = await ctx.glob("*");

        for (const file of rootFiles) {
          if (ALLOWED_ROOT_FILES.has(file)) continue;

          ctx.report.violation({
            message: `"${file}" is not on the GEN-005 repository root allowlist`,
            file,
            fix: `Move "${file}" into an appropriate subdirectory (e.g. scripts/), or if it belongs at the root, add it to ALLOWED_ROOT_FILES in this rules file and state which GEN-005 Decision criterion it satisfies`,
          });
        }
      },
    },
  },
} satisfies RuleSet;
