/// <reference path="../rules.d.ts" />

const COMMANDS_DIR = "src/commands";
const DOCS_DIR = "docs/src/content/docs/reference/cli";

/**
 * A command word is a plain kebab-case token. Parsing a heading's command
 * path stops at the first non-word token (`<arg>`, `[opt]`, `--flag`).
 */
const COMMAND_WORD = /^[a-z][a-z0-9-]*$/u;

export default {
  rules: {
    "subcommand-has-docs-heading": {
      description:
        "Every subcommand module (src/commands/<parent>/**) must have a corresponding heading in the top-level parent's .mdx reference page, at every nesting depth, and vice versa",
      severity: "error",
      async check(ctx) {
        // ── 1. Discover full command paths from src/commands/ ────────────
        // A group is any directory with an index.ts; its subcommands are
        // sibling <sub>.ts modules and child groups, at any depth
        // (adr/domain/add.ts = "adr domain add"). Subcommands registered
        // inside a leaf module are invisible here — handled in step 2.
        const groupIndexFiles = await ctx.glob(`${COMMANDS_DIR}/**/index.ts`);
        const groupDirs = new Set(
          groupIndexFiles.map((f) =>
            f.slice(COMMANDS_DIR.length + 1, -"/index.ts".length)
          )
        );

        const allFiles = await ctx.glob(`${COMMANDS_DIR}/**/*.ts`);
        /** Full command paths (segment arrays), keyed by top-level parent. */
        const pathsByParent = new Map<string, Set<string>>();
        const fileByPath = new Map<string, string>();

        for (const file of allFiles) {
          const rel = file.slice(COMMANDS_DIR.length + 1, -".ts".length);
          const segments = rel.split("/");
          const cmdSegments =
            segments[segments.length - 1] === "index"
              ? segments.slice(0, -1)
              : segments;
          // Top-level commands (single segment) are ARCH-015's concern.
          if (cmdSegments.length < 2) continue;
          // Every ancestor must be a group directory — a stray nested file
          // under a non-group directory is not a subcommand.
          const ancestorsAreGroups = cmdSegments
            .slice(0, -1)
            .every((_, i) =>
              groupDirs.has(cmdSegments.slice(0, i + 1).join("/"))
            );
          if (!ancestorsAreGroups) continue;

          const parent = cmdSegments[0];
          const cmdPath = cmdSegments.join(" ");
          if (!pathsByParent.has(parent)) pathsByParent.set(parent, new Set());
          pathsByParent.get(parent)!.add(cmdPath);
          fileByPath.set(cmdPath, file);
        }

        // ── 2. Compare against each parent page's headings ───────────────
        const docsResults = await Promise.all(
          [...pathsByParent.entries()].map(async ([parentName, cmdPaths]) => {
            const docsFile = `${DOCS_DIR}/${parentName}.mdx`;
            let docsContent: string | null;
            try {
              docsContent = await ctx.readFile(docsFile);
            } catch {
              // ARCH-015 reports the missing page; skip subcommand checks
              docsContent = null;
            }
            return { parentName, cmdPaths, docsFile, docsContent };
          })
        );

        for (const {
          parentName,
          cmdPaths,
          docsFile,
          docsContent,
        } of docsResults) {
          if (docsContent === null) continue;

          // Heading lines like "#### archgate adr domain add <name>" —
          // capture the command-word sequence after "archgate".
          const documented = new Set<string>();
          for (const line of docsContent.split("\n")) {
            const heading = /^#{1,4}\s+.*?\barchgate\s+(.+)$/u.exec(line);
            if (heading === null) continue;
            const words: string[] = [];
            for (const token of heading[1].trim().split(/\s+/u)) {
              const word = token.replace(/`+$/u, "").toLowerCase();
              if (!COMMAND_WORD.test(word)) break;
              words.push(word);
            }
            if (words.length >= 2 && words[0] === parentName.toLowerCase()) {
              documented.add(words.join(" "));
            }
          }

          // Subcommand -> docs: every module-backed path needs a heading.
          for (const cmdPath of [...cmdPaths].sort()) {
            if (!documented.has(cmdPath.toLowerCase())) {
              ctx.report.violation({
                message: `Subcommand "archgate ${cmdPath}" has no heading in ${docsFile}`,
                file: fileByPath.get(cmdPath),
                fix: `Add an "archgate ${cmdPath}" heading (level per nesting depth) to ${docsFile} documenting the subcommand`,
              });
            }
          }

          // Docs -> subcommand: a heading is an orphan only when its parent
          // chain consists of group directories — a heading under a leaf
          // module (e.g. "session-context claude-code list") documents an
          // in-module subcommand the file layout cannot verify.
          const lowerPaths = new Set([...cmdPaths].map((p) => p.toLowerCase()));
          for (const docPath of [...documented].sort()) {
            if (lowerPaths.has(docPath)) continue;
            const segments = docPath.split(" ");
            const parentChainIsGroups = segments
              .slice(0, -1)
              .every((_, i) =>
                groupDirs.has(segments.slice(0, i + 1).join("/"))
              );
            if (!parentChainIsGroups) continue;
            ctx.report.violation({
              message: `Heading "archgate ${docPath}" in ${docsFile} has no corresponding subcommand module`,
              file: docsFile,
              fix: `Either create ${COMMANDS_DIR}/${segments.join("/")}.ts to match, or remove the orphan heading`,
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
