/// <reference path="../rules.d.ts" />

/**
 * ARCH-008 enforcement, rewritten on top of ctx.ast() (ARCH-022).
 *
 * The previous implementation grepped single lines for `.option(...)` and
 * missed any call formatted across multiple lines — exactly the fragility
 * ARCH-022 was introduced to fix. These rules now walk the ESTree produced
 * by ctx.ast(file, "typescript") and inspect real CallExpression arguments,
 * so formatting, whitespace, and string escaping no longer matter.
 */

interface EsNode {
  type?: string;
  [key: string]: unknown;
}

/**
 * Description strings that enumerate a fixed set of values, e.g.
 * "editor integration to configure (claude, cursor, vscode, copilot)" or
 * "ADR domain: backend, frontend, data, architecture, general".
 * Same heuristic as the previous regex rule, but applied to the parsed
 * Literal VALUE rather than raw source text.
 */
const CHOICE_ENUMERATION = /(?:claude.*cursor|backend.*frontend)/u;

/** A flag literal like "--editor <editor>" — a value-taking long option. */
const VALUE_TAKING_FLAG = /^--[\w-]+\s+<\w+>/u;

/** Bare global parsers that must not be passed as .option()'s third arg. */
const PARSER_IDENTIFIERS = new Set(["parseInt", "parseFloat", "Number"]);

/** Depth-first walk over an ESTree-shaped tree. */
function walk(node: unknown, visit: (n: EsNode) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (!node || typeof node !== "object") return;
  const n = node as EsNode;
  if (typeof n.type === "string") visit(n);
  for (const value of Object.values(n)) {
    if (value && typeof value === "object") walk(value, visit);
  }
}

/** Collect the argument lists of every `<expr>.option(...)` call in a tree. */
function findOptionCallArgs(tree: AstNode): EsNode[][] {
  const calls: EsNode[][] = [];
  walk(tree, (n) => {
    if (n.type !== "CallExpression") return;
    const callee = n.callee as EsNode | undefined;
    if (callee?.type !== "MemberExpression" || callee.computed === true) return;
    const property = callee.property as
      | (EsNode & { name?: string })
      | undefined;
    if (property?.type !== "Identifier" || property.name !== "option") return;
    calls.push((n.arguments as EsNode[] | undefined) ?? []);
  });
  return calls;
}

function isStringLiteral(
  node: EsNode | undefined
): node is EsNode & { value: string } {
  return node?.type === "Literal" && typeof node.value === "string";
}

/**
 * Locate the 1-based line of an option's flag string in the ORIGINAL source.
 *
 * ctx.ast(file, "typescript") parses Bun-transpiled output, which reprints
 * the module and collapses multi-line calls onto single lines — node.loc
 * therefore refers to transpiled lines and is unusable for reporting.
 * Searching the untranspiled source for the quoted flag literal gives an
 * exact line instead; when the flag can't be found (e.g. built dynamically),
 * the violation is reported file-only rather than with a wrong line.
 */
function findFlagLine(source: string, flag: string): number | undefined {
  const needles = [`"${flag}"`, `'${flag}'`, `\`${flag}\``];
  const lines = source.split("\n");
  for (const [index, lineText] of lines.entries()) {
    if (needles.some((needle) => lineText.includes(needle))) return index + 1;
  }
  return undefined;
}

function reportWithLine(
  ctx: RuleContext,
  detail: { message: string; file: string; fix: string },
  source: string,
  flag: string | undefined
): void {
  const line = flag === undefined ? undefined : findFlagLine(source, flag);
  ctx.report.violation({ ...detail, ...(line === undefined ? {} : { line }) });
}

export default {
  rules: {
    "use-add-option-for-choices": {
      description:
        "Commands with fixed-choice options must use addOption with choices() instead of plain option()",
      severity: "error",
      async check(ctx) {
        const files = ctx.scopedFiles.filter((f) => !f.endsWith("index.ts"));
        await Promise.all(
          files.map(async (file) => {
            const tree = await ctx.ast(file, "typescript");
            // Flag .option(flag, description, ...) calls — at least two
            // string literal args (a trailing default value or parser must
            // not exempt the call) — whose description enumerates choices.
            const flagged: string[] = [];
            for (const args of findOptionCallArgs(tree)) {
              if (args.length < 2) continue;
              const [flag, description] = args;
              if (!isStringLiteral(flag) || !isStringLiteral(description)) {
                continue;
              }
              if (!VALUE_TAKING_FLAG.test(flag.value)) continue;
              if (!CHOICE_ENUMERATION.test(description.value)) continue;
              flagged.push(flag.value);
            }
            if (flagged.length === 0) return;
            const source = await ctx.readFile(file);
            for (const flag of flagged) {
              reportWithLine(
                ctx,
                {
                  message:
                    "Use new Option().choices() with .addOption() instead of .option() for fixed-choice options",
                  file,
                  fix: "Replace .option() with new Option(...).choices([...] as const) and register via .addOption()",
                },
                source,
                flag
              );
            }
          })
        );
      },
    },
    "use-add-option-for-arg-parser": {
      description:
        "Options with custom parsers must use addOption with argParser() instead of passing a parser to option()",
      severity: "error",
      async check(ctx) {
        const files = ctx.scopedFiles.filter((f) => !f.endsWith("index.ts"));
        await Promise.all(
          files.map(async (file) => {
            const tree = await ctx.ast(file, "typescript");
            // Flag .option(flag, description, parser) calls whose third
            // argument is a function expression or a bare global parser
            // identifier (parseInt/parseFloat/Number). Literal defaults
            // (strings, numbers, booleans) remain allowed.
            const flagged: (string | undefined)[] = [];
            for (const args of findOptionCallArgs(tree)) {
              if (args.length < 3) continue;
              const third = args[2];
              const isFunctionArg =
                third?.type === "ArrowFunctionExpression" ||
                third?.type === "FunctionExpression";
              const isParserIdentifier =
                third?.type === "Identifier" &&
                PARSER_IDENTIFIERS.has((third as { name?: string }).name ?? "");
              if (!isFunctionArg && !isParserIdentifier) continue;
              const flag = args[0];
              flagged.push(isStringLiteral(flag) ? flag.value : undefined);
            }
            if (flagged.length === 0) return;
            const source = await ctx.readFile(file);
            for (const flag of flagged) {
              reportWithLine(
                ctx,
                {
                  message:
                    "Use new Option().argParser() with .addOption() instead of passing a parser to .option()",
                  file,
                  fix: "Replace .option() with new Option(...).argParser((val) => ...) and register via .addOption()",
                },
                source,
                flag
              );
            }
          })
        );
      },
    },
  },
} satisfies RuleSet;
