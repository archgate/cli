/// <reference path="../rules.d.ts" />

/**
 * ARCH-023: file listing in src/engine/ must match in memory against the
 * git-tracked set. Bun.Glob scanning is fallback-only and confined to the
 * two modules that implement the fallback. Walks the ESTree via
 * ctx.ast()/ctx.findAstNodes() (ARCH-022) for real `.scan(...)` call sites,
 * so a comment or string mentioning `.scan(` is not a match.
 */
const SCAN_ALLOWED_FILES = new Set([
  "src/engine/glob-utils.ts",
  "src/engine/git-files.ts",
]);

/** Genuinely narrows to an ESTree node — every real node carries `type`. */
function isEsTreeNode(value: unknown): value is EsTreeNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}

/** Safely narrow a value to EsTreeNode, or undefined if it isn't one. */
function asEsTreeNode(value: unknown): EsTreeNode | undefined {
  return isEsTreeNode(value) ? value : undefined;
}

/** True for `<expr>.scan(...)` -- a non-computed `.scan` member call. */
function isScanCall(node: EsTreeNode): boolean {
  if (node.type !== "CallExpression") return false;
  const callee = asEsTreeNode(node.callee);
  if (callee?.type !== "MemberExpression" || callee.computed === true) {
    return false;
  }
  const property = asEsTreeNode(callee.property);
  return property?.type === "Identifier" && property.name === "scan";
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
    "scan-confined-to-fallback-modules": {
      description:
        "Bun.Glob#scan() call sites in src/engine/ are confined to glob-utils.ts and git-files.ts — everywhere else must use in-memory matching (listMatchingFiles/matchTrackedFiles)",
      severity: "error",
      async check(ctx) {
        const files = ctx.scopedFiles.filter(
          (f) => f.endsWith(".ts") && !SCAN_ALLOWED_FILES.has(f)
        );

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
          // (ARCH-022), but relative order survives transpilation, which
          // only erases type-only syntax -- enough to pair each call with
          // its re-located line below.
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
          for (const _call of scanCalls) {
            const { line, nextIndex } = nextScanLine(code, cursor);
            cursor = nextIndex;

            ctx.report.violation({
              message:
                "Bun.Glob#scan() in src/engine/ is fallback-only and confined to glob-utils.ts/git-files.ts — walking the filesystem per rule re-introduces the traversal cost ARCH-023 eliminates",
              file,
              ...(line === undefined ? {} : { line }),
              fix: "Use listMatchingFiles() or matchTrackedFiles() from src/engine/glob-utils.ts; if a genuine new fallback is required, update ARCH-023 and its allowlist with maintainer approval",
            });
          }
        });
        await Promise.all(checks);
      },
    },
  },
} satisfies RuleSet;
