/// <reference path="../rules.d.ts" />

const COMMANDS_DIR = "src/commands";
const DOCS_DIR = "docs/src/content/docs/reference/cli";

export default {
  rules: {
    "subcommand-has-docs-heading": {
      description:
        "Every subcommand file (src/commands/<parent>/<sub>.ts) must have a corresponding heading in the parent's .mdx reference page, and vice versa",
      severity: "error",
      async check(ctx) {
        // ── 1. Discover subcommand names from src/commands/ ──────────────
        //
        // Top-level command groups live at src/commands/<parent>/index.ts.
        // Direct subcommands are either:
        //   src/commands/<parent>/<sub>.ts          (single-file subcommand)
        //   src/commands/<parent>/<sub>/index.ts    (nested command group)
        //
        // We only look one level deep: <parent>/<sub>. Files like
        // src/commands/adr/domain/add.ts are sub-subcommands of "adr domain"
        // and are NOT checked by this rule (they are documented in the
        // "adr domain" section as a table, not as separate headings).

        // Find all parent command groups (dirs with an index.ts).
        const groupIndexFiles = await ctx.glob(`${COMMANDS_DIR}/*/index.ts`);

        // Extract parent names from index files.
        const parentNames = groupIndexFiles.map((indexFile) => {
          const rel = indexFile.slice(COMMANDS_DIR.length + 1);
          return rel.split("/")[0];
        });

        // Discover subcommands for all parents in parallel.
        const subResults = await Promise.all(
          parentNames.map(async (parentName) => {
            const [subFiles, nestedGroupFiles] = await Promise.all([
              ctx.glob(`${COMMANDS_DIR}/${parentName}/*.ts`),
              ctx.glob(`${COMMANDS_DIR}/${parentName}/*/index.ts`),
            ]);

            const subs = new Set<string>();

            // Single-file subcommands
            for (const sf of subFiles) {
              const fileName = sf.slice(
                `${COMMANDS_DIR}/${parentName}/`.length
              );
              if (fileName === "index.ts") continue;
              subs.add(fileName.slice(0, -".ts".length));
            }

            // Nested command groups
            for (const ngf of nestedGroupFiles) {
              const nestedRel = ngf.slice(
                `${COMMANDS_DIR}/${parentName}/`.length
              );
              subs.add(nestedRel.split("/")[0]);
            }

            return { parentName, subs };
          })
        );

        const subcommandsByParent = new Map<string, Set<string>>();
        for (const { parentName, subs } of subResults) {
          subcommandsByParent.set(parentName, subs);
        }

        // ── 2. Check docs for each subcommand (parallel reads) ──────────

        // Heading pattern: any markdown heading containing "archgate <parent> <sub>"
        // We look for lines like:  ## archgate adr create
        //                          ### archgate adr domain
        const headingPattern = /^#{1,4}\s+.*archgate\s+(\S+)\s+(\S+)/giu;

        // Read all docs files in parallel.
        const docsResults = await Promise.all(
          [...subcommandsByParent.entries()].map(
            async ([parentName, subNames]) => {
              const docsFile = `${DOCS_DIR}/${parentName}.mdx`;
              let docsContent: string | null;
              try {
                docsContent = await ctx.readFile(docsFile);
              } catch {
                // ARCH-015 will report the missing page; skip subcommand checks
                docsContent = null;
              }
              return { parentName, subNames, docsFile, docsContent };
            }
          )
        );

        // Report violations.
        for (const {
          parentName,
          subNames,
          docsFile,
          docsContent,
        } of docsResults) {
          if (docsContent === null) continue;

          // Extract documented subcommand names from headings
          const documentedSubs = new Set<string>();
          let match;
          headingPattern.lastIndex = 0;
          for (const line of docsContent.split("\n")) {
            headingPattern.lastIndex = 0;
            match = headingPattern.exec(line);
            if (match) {
              const docParent = match[1].toLowerCase();
              const docSub = match[2].toLowerCase();
              if (docParent === parentName.toLowerCase()) {
                documentedSubs.add(docSub);
              }
            }
          }

          // Subcommand -> docs: missing headings.
          for (const sub of [...subNames].sort()) {
            if (!documentedSubs.has(sub.toLowerCase())) {
              ctx.report.violation({
                message: `Subcommand "archgate ${parentName} ${sub}" has no heading in ${docsFile}`,
                file: `${COMMANDS_DIR}/${parentName}/${sub}.ts`,
                fix: `Add a "## archgate ${parentName} ${sub}" heading to ${docsFile} documenting the subcommand`,
              });
            }
          }

          // Docs -> subcommand: orphan headings.
          for (const docSub of [...documentedSubs].sort()) {
            if (
              ![...subNames].some(
                (s) => s.toLowerCase() === docSub.toLowerCase()
              )
            ) {
              ctx.report.violation({
                message: `Heading "archgate ${parentName} ${docSub}" in ${docsFile} has no corresponding subcommand file`,
                file: docsFile,
                fix: `Either create ${COMMANDS_DIR}/${parentName}/${docSub}.ts to match, or remove the orphan heading`,
              });
            }
          }
        }
      },
    },
  },
} satisfies RuleSet;
