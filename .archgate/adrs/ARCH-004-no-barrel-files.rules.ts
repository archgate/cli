/// <reference path="../rules.d.ts" />

/**
 * A Program body is barrel-shaped when every top-level statement is purely
 * import/re-export plumbing:
 * - ImportDeclaration            — `import { x } from "./y"` / `import "./y"`
 * - ExportAllDeclaration         — `export * from "./y"`
 * - ExportNamedDeclaration with  — `export { x } from "./y"` / `export { x }`
 *   declaration === null
 *
 * Anything else — `export const x = ...`, `export default ...`, function or
 * class declarations, expression statements — is executable logic, so the
 * file is not a barrel.
 */
function isReExportOnlyBody(body: EsTreeNode[]): boolean {
  return body.every((node) => {
    if (node.type === "ImportDeclaration") return true;
    if (node.type === "ExportAllDeclaration") return true;
    return (
      node.type === "ExportNamedDeclaration" &&
      (node.declaration === null || node.declaration === undefined)
    );
  });
}

/**
 * Fallback for files whose transpiled Program body is EMPTY: ctx.ast()
 * transpiles TypeScript before parsing, which erases type-only syntax
 * (`export type { X } from "./y"`, `import type ...`), so a pure
 * type-re-export barrel parses to an empty Program. Conservatively inspect
 * the source: strip comments and blank space, then require every remaining
 * statement to start with `import` or `export`. A comment-only/empty file
 * is not a barrel.
 *
 * Handles multi-line statements (e.g. `export type {\n  A,\n} from ...`)
 * by tracking brace depth — continuation lines inside `{ }` are part of
 * the enclosing import/export, not new statements.
 */
function isTypeOnlyBarrel(source: string): boolean {
  const stripped = source
    .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
    .replaceAll(/\/\/[^\n]*/gu, "")
    .trim();

  if (stripped === "") return false;

  const lines = stripped
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && l !== ";");

  if (lines.length === 0) return false;

  let braceDepth = 0;
  for (const line of lines) {
    if (braceDepth === 0 && !/^(?:import|export)\b/u.test(line)) {
      return false;
    }
    for (const ch of line) {
      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth--;
    }
  }

  return true;
}

export default {
  rules: {
    "no-barrel-files": {
      description: "index.ts files must not be pure re-export barrels",
      severity: "error",
      async check(ctx) {
        const indexFiles = ctx.scopedFiles.filter((f) =>
          f.endsWith("/index.ts")
        );

        const checks = indexFiles.map(async (file) => {
          let program: EsTreeProgram;
          try {
            program = await ctx.ast(file, "typescript");
          } catch {
            // A syntactically broken index.ts must not kill this rule for
            // every other file — typecheck/lint report real syntax errors.
            return;
          }

          const barrel =
            program.body.length > 0
              ? isReExportOnlyBody(program.body)
              : isTypeOnlyBarrel(await ctx.readFile(file));

          if (barrel) {
            ctx.report.violation({
              message: `Barrel file detected: ${file} contains only re-exports and no logic. Import directly from source modules instead.`,
              file,
              fix: "Delete this barrel file and update all imports to point directly to the source module (e.g., import from './adr' instead of '.')",
            });
          }
        });

        await Promise.all(checks);
      },
    },
  },
} satisfies RuleSet;
