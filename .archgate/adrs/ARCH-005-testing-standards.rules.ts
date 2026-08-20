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

        /** Script names whose command splits the run across processes. */
        const multiprocess = new Set<string>();

        for (const [name, command] of Object.entries(scripts)) {
          if (typeof command !== "string") continue;
          const flag = MULTIPROCESS_FLAGS.find((f) => command.includes(f));
          if (flag === undefined) continue;
          multiprocess.add(name);

          if (!command.includes("--coverage")) continue;
          ctx.report.violation({
            message: `Script "${name}" combines ${flag} with --coverage; multi-process runs inflate the lines-found denominator and fail the 99.9% gate`,
            file: "package.json",
            fix: `Drop ${flag} from "${name}". Use it on a script that reports no coverage, such as "test".`,
          });
        }

        // A caller can reopen this without touching package.json:
        // `bun run test --coverage` appends the flag to a parallel script. That
        // is how the Windows smoke job silently dropped the merged gate to
        // 90.5%, and it is invisible to the scripts pass above.
        const callSite = new RegExp(
          String.raw`bun run (${[...multiprocess].join("|")})\b[^\n]*--coverage`,
          "u"
        );
        if (multiprocess.size === 0) return;

        for (const file of await ctx.glob(".github/workflows/*.yml")) {
          // oxlint-disable-next-line no-await-in-loop -- reads are cached per path
          const text = await ctx.readFile(file);
          const match = callSite.exec(text);
          if (match === null) continue;
          ctx.report.violation({
            message: `"${match[0].trim()}" adds --coverage to "${match[1]}", which runs multi-process; the inflated denominator fails the 99.9% gate`,
            file,
            fix: `Call the single-process script instead, e.g. \`bun run test:coverage\` (GEN-003 — invoke by script name rather than appending flags).`,
          });
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
