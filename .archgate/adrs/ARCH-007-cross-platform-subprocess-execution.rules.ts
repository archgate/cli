/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "no-bun-shell": {
      description:
        "Subprocess execution must use Bun.spawn, not Bun.$ (shell hangs on Windows)",
      async check(ctx) {
        const files = ctx.scopedFiles.filter(
          (f) => !f.includes("tests/") && !f.includes(".archgate/")
        );

        // Check for Bun.$ template literal usage
        const bunShellMatches = await Promise.all(
          files.map((file) => ctx.grep(file, /Bun\.\$`/u))
        );
        for (const fileMatches of bunShellMatches) {
          for (const m of fileMatches) {
            ctx.report.violation({
              message:
                "Do not use Bun.$ template literals — they hang on Windows due to pipe deadlocks. Use Bun.spawn instead.",
              file: m.file,
              line: m.line,
              fix: "Replace Bun.$`cmd args` with Bun.spawn(['cmd', 'args'], { stdout: 'pipe', stderr: 'pipe' })",
            });
          }
        }

        // Check for $ import from "bun" (the shell API)
        const dollarImportMatches = await Promise.all(
          files.map((file) =>
            ctx.grep(file, /import\s*\{[^}]*\$[^}]*\}\s*from\s*["']bun["']/u)
          )
        );
        for (const fileMatches of dollarImportMatches) {
          for (const m of fileMatches) {
            ctx.report.violation({
              message:
                'Do not import $ from "bun" — the Bun shell API hangs on Windows. Use Bun.spawn instead.',
              file: m.file,
              line: m.line,
              fix: 'Remove the $ import from "bun" and replace shell calls with Bun.spawn',
            });
          }
        }

        // Check for await $` pattern (destructured $ usage)
        const destructuredMatches = await Promise.all(
          files.map((file) => ctx.grep(file, /await\s+\$`/u))
        );
        for (const fileMatches of destructuredMatches) {
          for (const m of fileMatches) {
            ctx.report.violation({
              message:
                "Do not use $` template literals (destructured Bun shell) — they hang on Windows. Use Bun.spawn instead.",
              file: m.file,
              line: m.line,
              fix: "Replace $`cmd args` with Bun.spawn(['cmd', 'args'], { stdout: 'pipe', stderr: 'pipe' })",
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
