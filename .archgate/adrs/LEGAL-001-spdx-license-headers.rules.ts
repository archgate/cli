/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "spdx-header-present": {
      description:
        "All TypeScript source files must have an SPDX-License-Identifier header",
      async check(ctx) {
        const results = await Promise.all(
          ctx.scopedFiles.map(async (file) => {
            const content = await ctx.readFile(file);
            return { file, content };
          })
        );

        for (const { file, content } of results) {
          if (content === null) continue;

          // Check first 5 lines for the SPDX identifier (allows for shebang)
          const lines = content.split("\n").slice(0, 5);
          const hasSpdx = lines.some((line) =>
            line.includes("SPDX-License-Identifier: Apache-2.0")
          );

          if (!hasSpdx) {
            ctx.report.violation({
              message:
                "Missing SPDX-License-Identifier header. Add `// SPDX-License-Identifier: Apache-2.0` as the first line.",
              file,
              line: 1,
              fix: 'Add "// SPDX-License-Identifier: Apache-2.0\\n// Copyright 2026 Archgate\\n" at the top of the file',
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
