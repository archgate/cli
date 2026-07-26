/// <reference path="../rules.d.ts" />

/**
 * ctx.glob() paths are always project-relative and forward-slash normalized
 * (per ARCH-020/ARCH-023's own convention), so plain string ops replace
 * node:path here instead of importing it — every other .rules.ts file in
 * this repo stays within the sandboxed ctx API with zero imports.
 */
function basenameNoExt(path: string, suffix: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.endsWith(suffix) ? base.slice(0, -suffix.length) : base;
}

function dirnameOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "." : path.slice(0, idx);
}

export default {
  rules: {
    "test-mirrors-src": {
      description: "Test directory structure should mirror src/ structure",
      severity: "error",
      async check(ctx) {
        const srcFiles = await ctx.glob("src/**/*.ts");
        const testFiles = await ctx.glob("tests/**/*.test.ts");

        const testBasenames = new Set(
          testFiles.map((f) => basenameNoExt(f, ".test.ts"))
        );

        for (const srcFile of srcFiles) {
          const name = basenameNoExt(srcFile, ".ts");
          // Skip index files, entry point, and type-only files
          if (name === "index" || name === "cli") continue;
          // Skip files in directories that have an index (command groups)
          if (srcFile.includes("/commands/") && srcFile.endsWith("/index.ts"))
            continue;

          if (!testBasenames.has(name)) {
            ctx.report.violation({
              message: `Source file "${srcFile}" has no matching test file`,
              file: srcFile,
              fix: `Create a test file at tests/${dirnameOf(srcFile).replace("src/", "")}/${name}.test.ts`,
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
