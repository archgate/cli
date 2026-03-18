import { defineRules } from "../../src/formats/rules";

export default defineRules({
  "use-log-error": {
    description:
      "Use logError() instead of console.error() for user-facing errors",
    async check(ctx) {
      const files = ctx.scopedFiles.filter(
        (f) => !f.endsWith("helpers/log.ts") && !f.includes("tests/")
      );
      const matches = await Promise.all(
        files.map((file) => ctx.grep(file, /console\.error\(/))
      );
      for (const fileMatches of matches) {
        for (const m of fileMatches) {
          ctx.report.violation({
            message:
              "Use logError() from helpers/log.ts instead of console.error()",
            file: m.file,
            line: m.line,
            fix: "Import { logError } from '../helpers/log' and use logError()",
          });
        }
      }
    },
  },
  "use-log-helpers": {
    description:
      "Use log helpers instead of console.log/warn/info in helper and engine files",
    async check(ctx) {
      const files = ctx.scopedFiles.filter(
        (f) =>
          (f.includes("helpers/") || f.includes("engine/")) &&
          !f.endsWith("helpers/log.ts") &&
          !f.endsWith("engine/reporter.ts") &&
          !f.endsWith("helpers/login-flow.ts") &&
          !f.includes("tests/")
      );
      const matches = await Promise.all(
        files.map((file) => ctx.grep(file, /console\.(log|warn|info)\s*\(/))
      );
      for (const fileMatches of matches) {
        for (const m of fileMatches) {
          ctx.report.violation({
            message:
              "Use logInfo/logWarn/logDebug from helpers/log.ts instead of direct console output",
            file: m.file,
            line: m.line,
            fix: "Import { logInfo, logWarn } from '../helpers/log' and use logInfo() or logWarn()",
          });
        }
      }
    },
  },
  "exit-code-convention": {
    description: "Process.exit should use codes 0, 1, or 2 only",
    async check(ctx) {
      const matches = await Promise.all(
        ctx.scopedFiles.map((file) => ctx.grep(file, /process\.exit\((\d+)\)/))
      );
      for (const fileMatches of matches) {
        for (const m of fileMatches) {
          const codeMatch = m.content.match(/process\.exit\((\d+)\)/);
          if (codeMatch) {
            const code = Number(codeMatch[1]);
            if (code !== 0 && code !== 1 && code !== 2) {
              ctx.report.violation({
                message: `Exit code ${code} is not standard. Use 0 (success), 1 (failure), or 2 (internal error)`,
                file: m.file,
                line: m.line,
              });
            }
          }
        }
      }
    },
  },
});
