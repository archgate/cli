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
        // Direct subcommands of a group (src/commands/<parent>/index.ts) are
        // <parent>/<sub>.ts or <parent>/<sub>/index.ts. Only one level deep
        // is checked: deeper files like adr/domain/add.ts are sub-subcommands
        // documented as a table in the parent's section, not as headings.

        const groupIndexFiles = await ctx.glob(`${COMMANDS_DIR}/*/index.ts`);

        const parentNames = groupIndexFiles.map((indexFile) => {
          const rel = indexFile.slice(COMMANDS_DIR.length + 1);
          return rel.split("/")[0];
        });

        const subResults = await Promise.all(
          parentNames.map(async (parentName) => {
            const [subFiles, nestedGroupFiles] = await Promise.all([
              ctx.glob(`${COMMANDS_DIR}/${parentName}/*.ts`),
              ctx.glob(`${COMMANDS_DIR}/${parentName}/*/index.ts`),
            ]);

            const subs = new Set<string>();

            for (const sf of subFiles) {
              const fileName = sf.slice(
                `${COMMANDS_DIR}/${parentName}/`.length
              );
              if (fileName === "index.ts") continue;
              subs.add(fileName.slice(0, -".ts".length));
            }

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

        for (const {
          parentName,
          subNames,
          docsFile,
          docsContent,
        } of docsResults) {
          if (docsContent === null) continue;

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
