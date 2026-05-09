/// <reference path="../rules.d.ts" />

const EMOJI_PATTERN =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
const EMOJI_IN_STRING =
  /["'`].*[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}].*["'`]/u;

export default {
  rules: {
    "no-emoji-in-output": {
      description: "CLI output must not contain emoji characters",
      async check(ctx) {
        const files = ctx.scopedFiles.filter(
          (f) => !f.includes("tests/") && !f.includes(".archgate/")
        );
        const matches = await Promise.all(
          files.map((file) => ctx.grep(file, EMOJI_PATTERN))
        );
        for (const fileMatches of matches) {
          for (const m of fileMatches) {
            if (EMOJI_IN_STRING.test(m.content)) {
              ctx.report.violation({
                message: "Do not use emoji in CLI output strings",
                file: m.file,
                line: m.line,
                fix: "Remove emoji from output strings",
              });
            }
          }
        }
      },
    },
    "use-style-text": {
      description: "Use styleText from node:util instead of raw ANSI codes",
      async check(ctx) {
        const files = ctx.scopedFiles.filter(
          (f) => !f.includes("tests/") && !f.includes(".archgate/")
        );
        const matches = await Promise.all(
          files.map((file) => ctx.grep(file, /\\u001b\[|\\x1b\[|\\033\[/u))
        );
        for (const fileMatches of matches) {
          for (const m of fileMatches) {
            ctx.report.violation({
              message:
                "Use styleText() from node:util instead of raw ANSI escape codes",
              file: m.file,
              line: m.line,
              fix: "Import { styleText } from 'node:util' and use styleText(style, text)",
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
