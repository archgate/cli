/// <reference path="../rules.d.ts" />

/**
 * ESTree statement shape (the subset this rule inspects). ctx.ast() returns
 * an untyped AstNode, so top-level statements are narrowed through this.
 */
interface EstreeStatement {
  type?: unknown;
  declaration?: unknown;
}

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
function isReExportOnlyBody(body: unknown[]): boolean {
  return body.every((node) => {
    const stmt = node as EstreeStatement;
    if (stmt.type === "ImportDeclaration") return true;
    if (stmt.type === "ExportAllDeclaration") return true;
    return (
      stmt.type === "ExportNamedDeclaration" &&
      (stmt.declaration === null || stmt.declaration === undefined)
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
 */
function isTypeOnlyBarrel(source: string): boolean {
  const stripped = source
    .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
    .replaceAll(/\/\/[^\n]*/gu, "")
    .trim();

  if (stripped === "") return false;

  const statements = stripped
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s !== "");

  return statements.every((s) => /^(?:import|export)\b/u.test(s));
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
          let program: AstNode;
          try {
            program = await ctx.ast(file, "typescript");
          } catch {
            // A syntactically broken index.ts must not kill this rule for
            // every other file — typecheck/lint report real syntax errors.
            return;
          }

          const body = (program as { body?: unknown[] }).body;
          if (!Array.isArray(body)) return;

          const barrel =
            body.length > 0
              ? isReExportOnlyBody(body)
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
