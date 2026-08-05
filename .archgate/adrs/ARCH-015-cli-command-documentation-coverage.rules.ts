/// <reference path="../rules.d.ts" />

const COMMANDS_DIR = "src/commands";
const DOCS_DIR = "docs/src/content/docs/reference/cli";

/**
 * Docs files that do NOT correspond to a command. `index.mdx` is the
 * landing page for the CLI reference section, not a command page.
 */
const EXEMPT_DOC_STEMS = new Set(["index"]);

type EsTreeNode = { type: string } & Record<string, unknown>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEsTreeNode(value: unknown): value is EsTreeNode {
  return isPlainObject(value) && typeof value.type === "string";
}

/** Depth-first walk over an ESTree-shaped tree. */
function walk(node: unknown, visit: (n: EsTreeNode) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  if (isEsTreeNode(node)) visit(node);
  for (const value of Object.values(node)) {
    if (Boolean(value) && typeof value === "object") walk(value, visit);
  }
}

export default {
  rules: {
    "cli-command-has-docs-page": {
      description:
        "Every top-level CLI command (src/commands/<name>.ts or src/commands/<name>/index.ts) must be registered in src/cli.ts and have a corresponding reference page at docs/src/content/docs/reference/cli/<name>.mdx, and vice versa",
      severity: "error",
      async check(ctx) {
        // Discover top-level command names from src/commands/. Per ARCH-001
        // they live at src/commands/<name>.ts (single-file) or
        // src/commands/<name>/index.ts (command group); nested files are
        // subcommands, not independent top-level commands.
        const commandNames = new Set<string>();
        const moduleByName = new Map<string, string>();

        const topLevelFiles = await ctx.glob(`${COMMANDS_DIR}/*.ts`);
        for (const file of topLevelFiles) {
          const name = file.slice(COMMANDS_DIR.length + 1, -".ts".length);
          commandNames.add(name);
          moduleByName.set(name, file);
        }

        const groupIndexFiles = await ctx.glob(`${COMMANDS_DIR}/*/index.ts`);
        for (const file of groupIndexFiles) {
          const rel = file.slice(COMMANDS_DIR.length + 1);
          const [name] = rel.split("/");
          commandNames.add(name);
          moduleByName.set(name, file);
        }

        // Cross-check src/cli.ts registration against the module layout: per
        // ARCH-001, register<Name>Command(program) kebab-cases to the module
        // name (registerReviewContextCommand -> review-context). Only
        // executable call expressions in the AST count — a call spelled in a
        // comment or string is not a registration.
        const cliAst: unknown = await ctx.ast("src/cli.ts", "typescript");
        const registered = new Set<string>();
        walk(cliAst, (node) => {
          if (node.type !== "CallExpression") return;
          const callee = node.callee;
          if (!isEsTreeNode(callee) || callee.type !== "Identifier") return;
          if (typeof callee.name !== "string") return;
          const m = /^register(\w+)Command$/u.exec(callee.name);
          if (m === null) return;
          const args: unknown[] = Array.isArray(node.arguments)
            ? node.arguments
            : [];
          const arg: unknown = args.at(0);
          if (args.length !== 1 || !isEsTreeNode(arg)) return;
          if (arg.type !== "Identifier" || arg.name !== "program") return;
          // Split acronym-to-word boundaries too: MCPServer -> mcp-server.
          registered.add(
            m[1]
              .replaceAll(/([A-Z]+)([A-Z][a-z])/gu, "$1-$2")
              .replaceAll(/([a-z0-9])([A-Z])/gu, "$1-$2")
              .toLowerCase()
          );
        });

        for (const name of [...commandNames].sort()) {
          if (!registered.has(name)) {
            const pascal = name
              .split("-")
              .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
              .join("");
            ctx.report.violation({
              message: `Command module "${name}" is never registered in src/cli.ts`,
              file: moduleByName.get(name),
              fix: `Call register${pascal}Command(program) in src/cli.ts, or remove the module`,
            });
          }
        }

        for (const name of [...registered].sort()) {
          if (!commandNames.has(name)) {
            ctx.report.violation({
              message: `register call for "${name}" in src/cli.ts has no command module at ${COMMANDS_DIR}/${name}.ts or ${COMMANDS_DIR}/${name}/index.ts`,
              file: "src/cli.ts",
              fix: `Create the module at a conventional path, or remove the register call`,
            });
          }
        }

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
