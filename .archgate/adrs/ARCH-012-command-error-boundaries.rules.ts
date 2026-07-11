/// <reference path="../rules.d.ts" />

/**
 * ARCH-012 enforcement, rewritten on top of ctx.ast() (ARCH-022).
 *
 * The previous implementation only regex-detected the PRESENCE of a try-catch
 * inside an async action. That let partial boundaries pass: src/commands/
 * check.ts once wrapped only loadRuleAdrs() in try/catch, and a UserError
 * thrown later by runChecks() escaped to main().catch(), where it was
 * miscaptured to Sentry with exit 2 (incident CLI-5). These rules now walk
 * the ESTree produced by ctx.ast(file, "typescript"): the boundary rule
 * additionally flags top-level awaited statements that sit OUTSIDE the
 * action's try block — the exact statements whose rejections escape the
 * boundary.
 */

/** Node types whose bodies run in their own context — awaits inside them are
 *  not executed at the action's top level, so don't descend into them. */
const FUNCTION_NODE_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

/**
 * Sanctioned exit paths that may be awaited outside the boundary. Both end
 * in process.exit() and swallow their own internal failures, so they cannot
 * produce a meaningful escaped rejection — flagging the common early-return
 * guard pattern (`if (!x) { logError(...); await exitWith(1); return; }`)
 * would be pure noise.
 */
const EXEMPT_AWAITED_CALLEES = new Set(["exitWith", "handleCommandError"]);

/** Depth-first walk over an ESTree-shaped tree. */
function walk(node: unknown, visit: (n: EsTreeNode) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (!node || typeof node !== "object") return;
  const n = node as EsTreeNode;
  if (typeof n.type === "string") visit(n);
  for (const value of Object.values(n)) {
    if (value && typeof value === "object") walk(value, visit);
  }
}

/** Callee name of a call expression node, or undefined for non-calls. */
function calleeName(node: EsTreeNode | undefined): string | undefined {
  if (node?.type !== "CallExpression") return undefined;
  const callee = node.callee as EsTreeNode | undefined;
  if (callee?.type === "Identifier") return String(callee.name ?? "");
  if (callee?.type === "MemberExpression") {
    const property = callee.property as EsTreeNode | undefined;
    if (property?.type === "Identifier") return String(property.name ?? "");
  }
  return undefined;
}

/**
 * Does this statement contain an AwaitExpression executed at the statement's
 * own level? Awaits inside nested function bodies are excluded — they belong
 * to the nested function's execution, not the action body's control flow.
 * Awaits of sanctioned exit paths (EXEMPT_AWAITED_CALLEES) are also excluded,
 * though their arguments are still searched for nested non-exempt awaits.
 */
function containsDirectAwait(node: unknown): boolean {
  if (Array.isArray(node))
    return node.some((item) => containsDirectAwait(item));
  if (!node || typeof node !== "object") return false;
  const n = node as EsTreeNode;
  if (typeof n.type === "string") {
    if (n.type === "AwaitExpression") {
      const arg = n.argument as EsTreeNode | undefined;
      const name = calleeName(arg);
      if (name === undefined || !EXEMPT_AWAITED_CALLEES.has(name)) {
        return true;
      }
      // Exempt await — still search its arguments for nested awaits.
      return containsDirectAwait(arg);
    }
    if (FUNCTION_NODE_TYPES.has(n.type)) return false;
  }
  for (const value of Object.values(n)) {
    if (value && typeof value === "object" && containsDirectAwait(value)) {
      return true;
    }
  }
  return false;
}

/** Collect the async function bodies of every `<expr>.action(async ...)` call. */
function findAsyncActionBodies(tree: EsTreeProgram): EsTreeNode[] {
  const bodies: EsTreeNode[] = [];
  walk(tree, (n) => {
    if (n.type !== "CallExpression") return;
    const callee = n.callee as EsTreeNode | undefined;
    if (callee?.type !== "MemberExpression" || callee.computed === true) return;
    const property = callee.property as EsTreeNode | undefined;
    if (property?.type !== "Identifier" || property.name !== "action") return;
    const handler = (n.arguments as EsTreeNode[] | undefined)?.[0];
    if (
      (handler?.type !== "ArrowFunctionExpression" &&
        handler?.type !== "FunctionExpression") ||
      handler.async !== true
    ) {
      return;
    }
    const body = handler.body as EsTreeNode | undefined;
    if (body?.type === "BlockStatement") bodies.push(body);
  });
  return bodies;
}

/**
 * Best-effort name of the awaited call for line lookup in the ORIGINAL
 * source. ctx.ast(file, "typescript") parses Bun-transpiled output whose
 * node.loc lines do not match the .ts source (see ARCH-022), so violations
 * locate their line by searching the untranspiled text instead.
 */
function awaitedCalleeName(statement: EsTreeNode): string | undefined {
  let name: string | undefined;
  walk(statement, (n) => {
    if (name !== undefined || n.type !== "AwaitExpression") return;
    const candidate = calleeName(n.argument as EsTreeNode | undefined);
    if (candidate !== undefined && !EXEMPT_AWAITED_CALLEES.has(candidate)) {
      name = candidate;
    }
  });
  return name;
}

/** Locate the 1-based line of `await <name>` in the original source. */
function findAwaitLine(source: string, name: string): number | undefined {
  const lines = source.split("\n");
  for (const [index, lineText] of lines.entries()) {
    if (lineText.includes("await") && lineText.includes(name)) {
      return index + 1;
    }
  }
  return undefined;
}

export default {
  rules: {
    "async-action-error-boundary": {
      description:
        "Async command actions must include try-catch error boundaries",
      severity: "warning",
      async check(ctx) {
        // Only check non-index command files
        const files = ctx.scopedFiles.filter(
          (f) => f.includes("commands/") && !f.endsWith("index.ts")
        );

        const checks = files.map(async (file) => {
          let tree: EsTreeProgram;
          try {
            tree = await ctx.ast(file, "typescript");
          } catch {
            return;
          }
          // Read once per file, outside the bodies loop — used for line
          // lookup because AST loc refers to transpiled output (ARCH-022).
          const source = await ctx.readFile(file);

          for (const body of findAsyncActionBodies(tree)) {
            const statements = (body.body as EsTreeNode[] | undefined) ?? [];
            const hasTopLevelTry = statements.some(
              (s) => s.type === "TryStatement"
            );

            if (!hasTopLevelTry) {
              ctx.report.warning({
                message:
                  "Async command action should include a try-catch error boundary",
                file,
                fix: "Wrap the action body in try { ... } catch (err) { await handleCommandError(err); }",
              });
              continue;
            }

            // Coverage check: top-level awaited statements outside the try
            // block reject straight past the boundary into main().catch(),
            // converting expected failures (exit 1) into internal crashes
            // (exit 2 + Sentry) — the CLI-5 incident pattern.
            const escaped = statements.filter(
              (s) => s.type !== "TryStatement" && containsDirectAwait(s)
            );
            for (const statement of escaped) {
              const name = awaitedCalleeName(statement);
              const line =
                name === undefined ? undefined : findAwaitLine(source, name);
              ctx.report.warning({
                message: `Awaited statement${
                  name === undefined ? "" : ` (await ${name}(...))`
                } sits outside the action's try-catch boundary — its rejection escapes to main().catch() as an internal crash`,
                file,
                ...(line === undefined ? {} : { line }),
                fix: "Move the statement inside the try block — the boundary must cover the entire action body (ARCH-012)",
              });
            }
          }
        });
        await Promise.all(checks);
      },
    },
    "exit-prompt-error-rethrow": {
      description:
        "Catch blocks in async command actions must re-throw ExitPromptError for proper Ctrl+C handling (exit 130)",
      async check(ctx) {
        // Only check non-index command files that have async actions
        const files = ctx.scopedFiles.filter(
          (f) => f.includes("commands/") && !f.endsWith("index.ts")
        );

        const checks = files.map(async (file) => {
          const content = await ctx.readFile(file);

          // Only check files with async actions that have try-catch
          const hasAsyncActionWithTryCatch =
            /\.action\(\s*async\s[\s\S]*?\btry\s*\{/u.test(content);
          if (!hasAsyncActionWithTryCatch) return;

          // Check for the ExitPromptError re-throw pattern anywhere in the file.
          // The canonical pattern is:
          //   if (err instanceof Error && err.name === "ExitPromptError") throw err;
          const hasExitPromptRethrow =
            /ExitPromptError|\bhandleCommandError\s*\(/u.test(content);

          if (!hasExitPromptRethrow) {
            ctx.report.violation({
              message:
                "Catch block in async command action must re-throw ExitPromptError so Ctrl+C exits with code 130 instead of code 1",
              file,
              fix: 'Add `if (err instanceof Error && err.name === "ExitPromptError") throw err;` as the first line in the catch block',
            });
          }
        });
        await Promise.all(checks);
      },
    },
  },
} satisfies RuleSet;
