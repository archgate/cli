/// <reference path="../rules.d.ts" />

// Highest allowed code point: 0x7F (DEL) and below is the ASCII range. Anything
// above 127 is decoded ambiguously by Windows PowerShell 5.1 on BOM-less files.
const MAX_ASCII = 0x7f;

export default {
  rules: {
    "ascii-only-ps1": {
      description:
        "PowerShell (.ps1) files must be ASCII-only (Windows PowerShell 5.1 mis-decodes non-ASCII in BOM-less scripts)",
      severity: "error",
      async check(ctx) {
        const files = ctx.scopedFiles.filter((f) => f.endsWith(".ps1"));

        const checks = files.map(async (file) => {
          let content: string;
          try {
            content = await ctx.readFile(file);
          } catch {
            return;
          }
          const lines = content.split("\n");

          for (const [index, line] of lines.entries()) {
            for (let col = 0; col < line.length; col++) {
              const codePoint = line.codePointAt(col) ?? 0;
              if (codePoint <= MAX_ASCII) continue;

              const char = String.fromCodePoint(codePoint);
              ctx.report.violation({
                message: `Non-ASCII character "${char}" (U+${codePoint
                  .toString(16)
                  .toUpperCase()
                  .padStart(
                    4,
                    "0"
                  )}) at column ${col + 1} breaks Windows PowerShell 5.1 parsing`,
                file,
                line: index + 1,
                fix: "Replace with an ASCII equivalent (e.g. em-dash with `-`, curly quotes with straight quotes)",
              });
              break; // one report per line is enough
            }
          }
        });
        await Promise.all(checks);
      },
    },
  },
} satisfies RuleSet;
