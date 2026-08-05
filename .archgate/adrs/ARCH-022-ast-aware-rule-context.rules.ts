/// <reference path="../rules.d.ts" />

/**
 * Identifiers that must appear, in this order, inside the `ast()` method of
 * `createRuleContext()` (src/engine/runner.ts). Each anchors one mandated
 * guardrail: safePath (path sandbox), AST_LANGUAGE_EXTENSIONS (language
 * plausibility), probeInterpreter (interpreter probe), runAstSubprocess
 * (guarded array-args invocation).
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

/** The single source of truth the `rules.d.ts` shim derives from. */
const RULE_TYPES_FILE = "src/formats/rules.ts";

/** Generator of the ambient `rules.d.ts` shim handed to rule authors. */
const SHIM_FILE = "src/helpers/rules-shim.ts";

/**
 * Loose object check, deliberately weaker than isEsTreeNode below — used
 * only to decide whether walk() should descend into a value at all. Keeps
 * descending into every plain object/array, not just ones that carry a
 * `type` field (e.g. `loc`), matching the walk's original behavior.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Genuinely narrows to an ESTree node, without an unsafe cast — every real
 * node carries a `type` field; a plain object without one (e.g. `loc`) is
 * not a node and must not be treated as one by callers of asEsTreeNode().
 */
function isEsTreeNode(value: unknown): value is EsTreeNode {
  return isPlainObject(value) && typeof value.type === "string";
}

/** Safely narrow a value to EsTreeNode, or undefined if it isn't one. */
function asEsTreeNode(value: unknown): EsTreeNode | undefined {
  return isEsTreeNode(value) ? value : undefined;
}

/** An ESTree node's `name` field, if it's actually a string. */
function nodeName(node: EsTreeNode | undefined): string | undefined {
  return typeof node?.name === "string" ? node.name : undefined;
}

/** Depth-first walk over an ESTree-shaped tree. */
function walk(node: unknown, visit: (n: EsTreeNode) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (!isPlainObject(node)) return;
  if (isEsTreeNode(node)) visit(node);
  for (const value of Object.values(node)) {
    if (Boolean(value) && typeof value === "object") walk(value, visit);
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
          // Current structure: `const astImpl = async (path, language) => {…}`
          // referenced as `ast: astImpl` in the returned object. The `as`
          // cast is erased by transpilation before ctx.ast() parses this file,
          // so the declarator init is a bare arrow/function expression.
          if (n.type === "VariableDeclarator") {
            const id = asEsTreeNode(n.id);
            const init = asEsTreeNode(n.init);
            if (
              nodeName(id) === "astImpl" &&
              (init?.type === "ArrowFunctionExpression" ||
                init?.type === "FunctionExpression")
            ) {
              astMethodBody = init.body;
            }
            return;
          }
          // Overloaded function declaration: `async function astImpl(…) {…}`
          if (n.type === "FunctionDeclaration") {
            const id = asEsTreeNode(n.id);
            if (nodeName(id) === "astImpl") {
              astMethodBody = n.body;
            }
            return;
          }
          // Fallback: inline `ast(path, language) { … }` object method, for
          // an implementation that lives directly on the returned object.
          if (n.type === "Property") {
            const key = asEsTreeNode(n.key);
            const value = asEsTreeNode(n.value);
            if (
              nodeName(key) === "ast" &&
              (value?.type === "FunctionExpression" ||
                value?.type === "ArrowFunctionExpression")
            ) {
              astMethodBody = value.body;
            }
          }
        });

        if (astMethodBody === null) {
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
          const name = typeof n.name === "string" ? n.name : "";
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
    "python-subprocess-isolated": {
      description:
        "The Python AST subprocess must run in isolated mode (-I) so a hostile target project cannot shadow stdlib modules on sys.path and execute arbitrary code",
      severity: "error",
      async check(ctx) {
        const file = "src/engine/runner.ts";
        const content = await ctx.readFile(file);
        // Locate the python branch of the guarded invocation and confirm the
        // argv includes the -I isolation flag before the -c program. Without
        // it, `python -c` puts the target project cwd on sys.path, letting a
        // planted ast.py/json.py run when the serializer imports them.
        const pythonCmd = /language === "python"\s*\?\s*\[([^\]]*)\]/u.exec(
          content
        );
        if (!pythonCmd) {
          ctx.report.violation({
            message: `Could not locate the Python invocation argv in ${file} — ARCH-022 requires it to run with -I isolated mode`,
            file,
            fix: 'Ensure the python branch builds `[interpreter, "-I", "-c", PYTHON_AST_PROGRAM, absPath]`',
          });
          return;
        }
        if (!/["']-I["']/u.test(pythonCmd[1])) {
          ctx.report.violation({
            message:
              "Python AST subprocess is missing the -I isolation flag — a hostile project could shadow stdlib modules (ast.py/json.py) and execute arbitrary code during `archgate check`",
            file,
            fix: 'Add "-I" as the first argument before "-c": `[interpreter, "-I", "-c", PYTHON_AST_PROGRAM, absPath]`',
          });
        }
      },
    },
    "rulecontext-shim-derived": {
      description:
        "src/helpers/rules-shim.ts must derive the ambient rules.d.ts from src/formats/rules.ts through the rules-source macro, never transcribe it — a hand-copied shim silently hands rule authors wrong types",
      severity: "error",
      async check(ctx) {
        // Type-only-ness of RULE_TYPES_FILE is not checked here:
        // generateRulesDts() throws on a value export, and `check` regenerates
        // the shim before rules run, so this rule could never observe one.
        const [macroImport, transcribed] = await Promise.all([
          ctx.grep(
            SHIM_FILE,
            /from "\.\/rules-source" with \{ type: "macro" \}/u
          ),
          ctx.grep(SHIM_FILE, /^\s*declare (?:interface|type) /u),
        ]);

        if (macroImport.length === 0) {
          ctx.report.violation({
            message: `${SHIM_FILE} does not read ${RULE_TYPES_FILE} through the rules-source macro — without it the shim is a hand-maintained copy that nothing verifies`,
            file: SHIM_FILE,
            fix: 'Import the source text via `import { rulesSourceText } from "./rules-source" with { type: "macro" }` and pass it through toAmbientDeclarations()',
          });
        }

        for (const m of transcribed) {
          ctx.report.violation({
            message: `Transcribed ambient declaration in ${SHIM_FILE} — the shim must derive every declaration from ${RULE_TYPES_FILE}, not restate it`,
            file: SHIM_FILE,
            line: m.line,
            fix: `Declare the type in ${RULE_TYPES_FILE}; toAmbientDeclarations() turns its exports into ambient declarations`,
          });
        }
      },
    },
    "single-ast-method": {
      description:
        "RuleContext exposes exactly one ast(path, language) method — no per-language variants like pythonAst()/rubyAst()",
      severity: "error",
      async check(ctx) {
        // One surface: rulecontext-shim-derived keeps the shim a derivation of
        // this file, so its ast() declarations follow by construction.
        const file = RULE_TYPES_FILE;
        const content = await ctx.readFile(file);
        const variantMatch =
          /\b(?:python|ruby|typescript|javascript|ts|js|py|rb)Ast\s*\(/iu.exec(
            content
          );
        if (variantMatch) {
          ctx.report.violation({
            message: `Per-language AST method "${variantMatch[0].trim()}" found in ${file} — ARCH-022 mandates a single ast(path, language) method`,
            file,
            fix: "Fold the per-language variant into the single ast(path, language) dispatch",
          });
        }
        const astSignatures = content.match(
          /^\s*ast\(path: string, language: AstLanguage, opts\?: AstOptions\): Promise<AstNode>;/gmu
        );
        if (astSignatures?.length !== 1) {
          ctx.report.violation({
            message: `${file} must declare exactly one \`ast(path: string, language: AstLanguage, opts?: AstOptions): Promise<AstNode>\` signature on RuleContext (found ${astSignatures?.length ?? 0})`,
            file,
            fix: "Declare the single ast() catch-all signature — including opts?: AstOptions — on RuleContext",
          });
        }
      },
    },
  },
} satisfies RuleSet;
