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

/** Flags that split a `bun test` run across more than one process. */
const MULTIPROCESS_FLAGS = ["--parallel", "--shard"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default {
  rules: {
    /**
     * Splitting a coverage run across processes inflates the lines-found
     * denominator without changing lines hit, so it fails the 99.9% gate while
     * covering identical code. See ARCH-005 Consequences → Risks.
     */
    "coverage-runs-single-process": {
      description:
        "test:coverage must not split across processes — it shifts the coverage denominator",
      severity: "error",
      async check(ctx) {
        // ctx.readFile rejects on a missing file rather than returning null,
        // so absence and malformed JSON share one guard.
        let scripts: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(
            await ctx.readFile("package.json")
          );
          if (!isRecord(parsed) || !isRecord(parsed.scripts)) return;
          scripts = parsed.scripts;
        } catch {
          return;
        }

        for (const [name, command] of Object.entries(scripts)) {
          if (typeof command !== "string") continue;
          if (!command.includes("--coverage")) continue;

          for (const flag of MULTIPROCESS_FLAGS) {
            if (!command.includes(flag)) continue;
            ctx.report.violation({
              message: `Script "${name}" combines ${flag} with --coverage; multi-process runs inflate the lines-found denominator and fail the 99.9% gate`,
              file: "package.json",
              fix: `Drop ${flag} from "${name}". Use it on a script that reports no coverage, such as "test".`,
            });
          }
        }
      },
    },
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
