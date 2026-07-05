/// <reference path="../rules.d.ts" />

/**
 * Identifiers that must appear, in this order, inside the `ast()` method of
 * `createRuleContext()` (src/engine/runner.ts). Each anchors one of the four
 * mandated guardrails:
 *   1. safePath                — path sandbox (same as readFile/glob)
 *   2. AST_LANGUAGE_EXTENSIONS — language plausibility check
 *   3. probeInterpreter        — interpreter availability probe
 *   4. runAstSubprocess        — guarded array-args invocation
 */
const GUARDRAIL_SEQUENCE = [
  "safePath",
  "AST_LANGUAGE_EXTENSIONS",
  "probeInterpreter",
  "runAstSubprocess",
];

/** Engine files sanctioned to call Bun.spawn (see ARCH-022 / ARCH-007). */
const SANCTIONED_SPAWN_FILES = new Set([
  "src/engine/ast-support.ts", // ctx.ast() interpreter probe + guarded invocation
  "src/engine/git-files.ts", // git subprocess helper, predates ARCH-022
]);

interface EsNode {
  type?: string;
  loc?: { start: { line: number; column: number } };
  [key: string]: unknown;
}

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

export default {
  rules: {
    "ast-guardrail-ordering": {
      description:
        "createRuleContext()'s ast() method must run the four ARCH-022 guardrails in order: path safety, language plausibility, interpreter probe, guarded invocation",
      severity: "error",
      async check(ctx) {
        const file = "src/engine/runner.ts";
        // Dogfood: this rule uses ctx.ast() itself to inspect the method that
        // implements ctx.ast(), instead of a regex over raw source.
        const tree = await ctx.ast(file, "typescript");

        let astMethodBody: unknown = null;
        walk(tree, (n) => {
          if (n.type !== "Property") return;
          const key = n.key as EsNode | undefined;
          const value = n.value as EsNode | undefined;
          if (
            key?.type === "Identifier" &&
            (key as { name?: string }).name === "ast" &&
            value?.type === "FunctionExpression"
          ) {
            astMethodBody = value.body;
          }
        });

        if (!astMethodBody) {
          ctx.report.violation({
            message:
              "Could not locate the ast() method inside createRuleContext() — ARCH-022 requires RuleContext to expose exactly this method",
            file,
            fix: "Restore the ast(path, language) method on the object returned by createRuleContext()",
          });
          return;
        }

        // Record the first occurrence position of each guardrail identifier.
        const firstSeen = new Map<string, number>();
        walk(astMethodBody, (n) => {
          if (n.type !== "Identifier" || !n.loc) return;
          const name = (n as { name?: string }).name ?? "";
          if (!GUARDRAIL_SEQUENCE.includes(name) || firstSeen.has(name)) {
            return;
          }
          firstSeen.set(
            name,
            n.loc.start.line * 1_000_000 + n.loc.start.column
          );
        });

        let previous = -1;
        for (const identifier of GUARDRAIL_SEQUENCE) {
          const position = firstSeen.get(identifier);
          if (position === undefined) {
            ctx.report.violation({
              message: `Guardrail marker "${identifier}" is missing from the ast() method — the four-step ARCH-022 ordering must be implemented in full`,
              file,
              fix: "Re-add the missing guardrail step to ast() in createRuleContext()",
            });
            return;
          }
          if (position <= previous) {
            ctx.report.violation({
              message: `Guardrail "${identifier}" runs out of order in the ast() method — ARCH-022 mandates path safety, then language plausibility, then interpreter probe, then guarded invocation`,
              file,
              fix: "Reorder ast() so each guardrail executes before the next one",
            });
            return;
          }
          previous = position;
        }
      },
    },
    "no-unsanctioned-engine-subprocess": {
      description:
        "Bun.spawn in src/engine/ is confined to ast-support.ts and git-files.ts; child_process is banned entirely",
      severity: "error",
      async check(ctx) {
        const spawnMatches = await ctx.grepFiles(
          /Bun\.spawn(Sync)?\s*\(/u,
          "src/engine/**/*.ts"
        );
        for (const m of spawnMatches) {
          if (SANCTIONED_SPAWN_FILES.has(m.file)) continue;
          ctx.report.violation({
            message: `Unsanctioned subprocess call in ${m.file} — ARCH-022 confines engine Bun.spawn usage to ${[...SANCTIONED_SPAWN_FILES].join(", ")}`,
            file: m.file,
            line: m.line,
            fix: "Route subprocess execution through the sanctioned helpers in ast-support.ts (ctx.ast) or git-files.ts (git)",
          });
        }

        const importMatches = await ctx.grepFiles(
          /from\s+["'](node:)?child_process["']|require\(\s*["'](node:)?child_process["']\s*\)/u,
          "src/engine/**/*.ts"
        );
        for (const m of importMatches) {
          ctx.report.violation({
            message: `child_process import in ${m.file} — banned in the engine; use Bun.spawn via a sanctioned helper (ARCH-007/ARCH-022)`,
            file: m.file,
            line: m.line,
            fix: "Remove the child_process import; use the sanctioned Bun.spawn helpers",
          });
        }
      },
    },
    "single-ast-method": {
      description:
        "RuleContext exposes exactly one ast(path, language) method — no per-language variants like pythonAst()/rubyAst()",
      severity: "error",
      async check(ctx) {
        const surfaces = ["src/formats/rules.ts", "src/helpers/rules-shim.ts"];
        const checks = surfaces.map(async (file) => {
          const content = await ctx.readFile(file);
          const variantMatch = content.match(
            /\b(?:python|ruby|typescript|javascript|ts|js|py|rb)Ast\s*\(/iu
          );
          if (variantMatch) {
            ctx.report.violation({
              message: `Per-language AST method "${variantMatch[0].trim()}" found in ${file} — ARCH-022 mandates a single ast(path, language) method`,
              file,
              fix: "Fold the per-language variant into the single ast(path, language) dispatch",
            });
          }
          const astSignatures = content.match(
            /^\s*ast\(path: string, language: AstLanguage\): Promise<AstNode>;/gmu
          );
          if (!astSignatures || astSignatures.length !== 1) {
            ctx.report.violation({
              message: `${file} must declare exactly one \`ast(path: string, language: AstLanguage): Promise<AstNode>\` signature on RuleContext (found ${astSignatures?.length ?? 0})`,
              file,
              fix: "Declare the single ast() signature on RuleContext",
            });
          }
        });
        await Promise.all(checks);
      },
    },
  },
} satisfies RuleSet;
