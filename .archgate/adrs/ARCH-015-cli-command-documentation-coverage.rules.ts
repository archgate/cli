/// <reference path="../rules.d.ts" />

const COMMANDS_DIR = "src/commands";
const DOCS_DIR = "docs/src/content/docs/reference/cli";

/**
 * Docs files that do NOT correspond to a command. `index.mdx` is the
 * landing page for the CLI reference section, not a command page.
 */
const EXEMPT_DOC_STEMS = new Set(["index"]);

export default {
  rules: {
    "cli-command-has-docs-page": {
      description:
        "Every top-level CLI command (src/commands/<name>.ts or src/commands/<name>/index.ts) must have a corresponding reference page at docs/src/content/docs/reference/cli/<name>.mdx, and vice versa",
      severity: "error",
      async check(ctx) {
        // Discover top-level command names from src/commands/.
        // Per ARCH-001, top-level commands live at either
        //   src/commands/<name>.ts           — single-file command
        //   src/commands/<name>/index.ts     — command group
        // Nested files like src/commands/<name>/create.ts or
        // src/commands/<name>/<sub>/index.ts are subcommands and NOT
        // independent top-level commands.
        const commandNames = new Set<string>();

        const topLevelFiles = await ctx.glob(`${COMMANDS_DIR}/*.ts`);
        for (const file of topLevelFiles) {
          const name = file.slice(COMMANDS_DIR.length + 1, -".ts".length);
          commandNames.add(name);
        }

        const groupIndexFiles = await ctx.glob(`${COMMANDS_DIR}/*/index.ts`);
        for (const file of groupIndexFiles) {
          const rel = file.slice(COMMANDS_DIR.length + 1);
          const [name] = rel.split("/");
          commandNames.add(name);
        }

        // Collect docs stems.
        const docFiles = await ctx.glob(`${DOCS_DIR}/*.mdx`);
        const docStems = new Set<string>();
        for (const file of docFiles) {
          const stem = file.slice(DOCS_DIR.length + 1, -".mdx".length);
          docStems.add(stem);
        }

        // Command -> docs: missing pages.
        for (const name of [...commandNames].sort()) {
          if (!docStems.has(name)) {
            ctx.report.violation({
              message: `CLI command "${name}" has no reference page at ${DOCS_DIR}/${name}.mdx`,
              file: `${COMMANDS_DIR}/${name}.ts`,
              fix: `Create ${DOCS_DIR}/${name}.mdx documenting the command and its subcommands (mirror the structure of a neighbouring page like adr.mdx or login.mdx)`,
            });
          }
        }

        // Docs -> command: orphan pages.
        for (const stem of [...docStems].sort()) {
          if (EXEMPT_DOC_STEMS.has(stem)) continue;
          if (!commandNames.has(stem)) {
            ctx.report.violation({
              message: `Reference page "${stem}.mdx" has no corresponding CLI command under ${COMMANDS_DIR}/`,
              file: `${DOCS_DIR}/${stem}.mdx`,
              fix: `Either create ${COMMANDS_DIR}/${stem}.ts (or ${COMMANDS_DIR}/${stem}/index.ts) to match, or remove the orphan page`,
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
