import { defineRules } from "../../src/formats/rules";
import { basename, dirname } from "node:path";

export default defineRules({
  "test-mirrors-src": {
    description: "Test directory structure should mirror src/ structure",
    severity: "error",
    async check(ctx) {
      // Get all src modules (non-index, non-cli.ts)
      const srcFiles = await ctx.glob("src/**/*.ts");
      const testFiles = await ctx.glob("tests/**/*.test.ts");

      const testBasenames = new Set(
        testFiles.map((f) => basename(f, ".test.ts"))
      );

      for (const srcFile of srcFiles) {
        const name = basename(srcFile, ".ts");
        // Skip index files, entry point, and type-only files
        if (name === "index" || name === "cli") continue;
        // Skip files in directories that have an index (command groups)
        if (srcFile.includes("/commands/") && srcFile.endsWith("/index.ts"))
          continue;

        if (!testBasenames.has(name)) {
          ctx.report.violation({
            message: `Source file "${srcFile}" has no matching test file`,
            file: srcFile,
            fix: `Create a test file at tests/${dirname(srcFile).replace("src/", "")}/${name}.test.ts`,
          });
        }
      }
    },
  },
});
