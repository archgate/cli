/// <reference path="../rules.d.ts" />

/**
 * ARCH-020 enforcement on top of ctx.ast() / ctx.findAstNodes() (ARCH-022):
 * walks the ESTree for real `<expr>.scan(...)` CallExpression nodes, so a
 * comment or string literal that merely mentions `.scan()` is not a match.
 */

/** True for `<expr>.scan(...)` -- a non-computed `.scan` member call. */
function isScanCall(node: EsTreeNode): boolean {
  if (node.type !== "CallExpression") return false;
  const callee = node.callee as EsTreeNode | undefined;
  if (callee?.type !== "MemberExpression" || callee.computed === true) {
    return false;
  }
  const property = callee.property as EsTreeNode | undefined;
  return property?.type === "Identifier" && property.name === "scan";
}

/**
 * Does this call's argument list include a `dot` option that isn't
 * disqualified? A non-literal value (identifier, expression) can't be
 * resolved statically, so it's treated as compliant; a literal value must
 * be `true` -- `dot: false` reproduces the exact bug this ADR prevents.
 */
function hasDotOption(call: EsTreeNode): boolean {
  const args = (call.arguments as EsTreeNode[] | undefined) ?? [];
  return args.some((arg) => {
    if (arg.type !== "ObjectExpression") return false;
    const properties = (arg.properties as EsTreeNode[] | undefined) ?? [];
    return properties.some((prop) => {
      if (prop.type !== "Property" || prop.computed === true) return false;
      const key = prop.key as
        | (EsTreeNode & { name?: unknown; value?: unknown })
        | undefined;
      const isDotKey =
        key?.type === "Identifier"
          ? key.name === "dot"
          : key?.type === "Literal" && key.value === "dot";
      if (!isDotKey) return false;
      const value = prop.value as
        | (EsTreeNode & { value?: unknown })
        | undefined;
      return value?.type !== "Literal" || value.value === true;
    });
  });
}

/**
 * Blank comments and string/template literals to spaces, keeping every
 * newline, so line numbers computed against the result match the original
 * source. Re-locates a call ctx.ast() already found structurally, since
 * `loc` is not trustworthy for `"typescript"` (ARCH-022). Does not track
 * regex literals, matching `source-positions.ts`.
 */
function blankNonCode(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      while (i < n && source[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out += " ";
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\" && i + 1 < n) {
          out += "  ";
          i += 2;
          continue;
        }
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) {
        out += " ";
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** 1-based line of the next `.scan(` at or after `fromIndex` in blanked `code`. */
function nextScanLine(
  code: string,
  fromIndex: number
): { line: number | undefined; nextIndex: number } {
  const idx = code.indexOf(".scan(", fromIndex);
  if (idx === -1) return { line: undefined, nextIndex: fromIndex };
  return { line: code.slice(0, idx).split("\n").length, nextIndex: idx + 6 };
}

export default {
  rules: {
    "glob-scan-dot": {
      description:
        "Bun.Glob#scan() calls must pass { dot: true } so dot-prefixed dirs (.github, .husky, ...) are traversed",
      severity: "error",
      async check(ctx) {
        const files = ctx.scopedFiles.filter((f) => f.endsWith(".ts"));

        const checks = files.map(async (file) => {
          let tree: EsTreeProgram;
          try {
            tree = await ctx.ast(file, "typescript");
          } catch {
            return;
          }

          const scanCalls = ctx
            .findAstNodes(tree, "CallExpression")
            .filter((node) => isScanCall(node));
          if (scanCalls.length === 0) return;

          // Sort by transpiled loc: not source-accurate for "typescript"
          // (ARCH-022), but Bun's transpiler only erases type-only syntax,
          // never reorders statements, so relative order is preserved --
          // enough to pair each call with its re-located line below.
          scanCalls.sort((a, b) => {
            const lineDiff =
              (a.loc?.start.line ?? 0) - (b.loc?.start.line ?? 0);
            if (lineDiff !== 0) return lineDiff;
            return (a.loc?.start.column ?? 0) - (b.loc?.start.column ?? 0);
          });

          let source: string;
          try {
            source = await ctx.readFile(file);
          } catch {
            return;
          }
          const code = blankNonCode(source);

          let cursor = 0;
          for (const call of scanCalls) {
            const { line, nextIndex } = nextScanLine(code, cursor);
            cursor = nextIndex;
            if (hasDotOption(call)) continue;

            ctx.report.violation({
              message:
                "Bun.Glob#scan() must pass { dot: true } or it silently skips dot-prefixed directories on Windows",
              file,
              ...(line === undefined ? {} : { line }),
              fix: "Add `dot: true` to the scan options, e.g. `glob.scan({ cwd, dot: true })`",
            });
          }
        });
        await Promise.all(checks);
      },
    },
  },
} satisfies RuleSet;
