/// <reference path="../rules.d.ts" />

/**
 * Determines whether a file is a barrel (re-export-only index.ts).
 *
 * A barrel file contains only export/import statements and no executable
 * logic — no function definitions, class definitions, variable declarations,
 * or statements beyond re-exports.
 */
function isBarrelFile(content: string): boolean {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l !== "" &&
        !l.startsWith("//") &&
        !l.startsWith("/*") &&
        !l.startsWith("*")
    );

  if (lines.length === 0) return false;

  return lines.every(
    (line) =>
      // export { Foo } from "./bar"  /  export type { Foo } from "./bar"
      line.startsWith("export ") ||
      line.startsWith("export{") ||
      // import type { Foo } from "./bar"
      line.startsWith("import ") ||
      // Continuation of multi-line export blocks
      line.startsWith("} from") ||
      line.startsWith("type ") ||
      /^[A-Za-z_$,\s]+$/u.test(line) ||
      line === "}" ||
      line === "};"
  );
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
          const content = await ctx.readFile(file);
          if (isBarrelFile(content)) {
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
