/// <reference path="../rules.d.ts" />

/**
 * ARCH-012 enforcement on top of ctx.ast() (ARCH-022). A try-catch that
 * covers only part of an action is as leaky as none, so the boundary rule
 * walks the ESTree and flags top-level awaited statements sitting OUTSIDE
 * the action's try block, whose rejections escape to main().catch() and
 * miscapture to Sentry. See ARCH-012 for the failure it prevents.
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

/**
 * Type guard narrowing an unknown AST value to an object node without an
 * unsafe cast — mirrors the previous `typeof x === "object"` check, so the
 * walk still descends into every plain object/array, not just ones that
 * already carry a `type` field.
 */
function isEsTreeNode(value: unknown): value is EsTreeNode {
  return typeof value === "object" && value !== null;
}

/** Safely narrow a value to EsTreeNode, or undefined if it isn't one. */
function asEsTreeNode(value: unknown): EsTreeNode | undefined {
  return isEsTreeNode(value) ? value : undefined;
}

/** The first element of an unknown value, narrowed to EsTreeNode if it is one. */
function firstNode(value: unknown): EsTreeNode | undefined {
  return Array.isArray(value) ? asEsTreeNode(value[0]) : undefined;
}

/** Narrow an unknown value to an array of EsTreeNodes, dropping non-nodes. */
function asEsTreeNodeArray(value: unknown): EsTreeNode[] {
  return Array.isArray(value)
    ? value.filter((item): item is EsTreeNode => isEsTreeNode(item))
    : [];
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
  if (!isEsTreeNode(node)) return;
  if (typeof node.type === "string") visit(node);
  for (const value of Object.values(node)) {
    if (Boolean(value) && typeof value === "object") walk(value, visit);
  }
}

/** Callee name of a call expression node, or undefined for non-calls. */
function calleeName(node: EsTreeNode | undefined): string | undefined {
  if (node?.type !== "CallExpression") return undefined;
  const callee = asEsTreeNode(node.callee);
  if (callee?.type === "Identifier") return nodeName(callee) ?? "";
  if (callee?.type === "MemberExpression") {
    const property = asEsTreeNode(callee.property);
    if (property?.type === "Identifier") return nodeName(property) ?? "";
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
  if (!isEsTreeNode(node)) return false;
  if (typeof node.type === "string") {
    if (node.type === "AwaitExpression") {
      const arg = asEsTreeNode(node.argument);
      const name = calleeName(arg);
      if (name === undefined || !EXEMPT_AWAITED_CALLEES.has(name)) {
        return true;
      }
      // Exempt await — still search its arguments for nested awaits.
      return containsDirectAwait(arg);
    }
    if (FUNCTION_NODE_TYPES.has(node.type)) return false;
  }
  for (const value of Object.values(node)) {
    if (
      Boolean(value) &&
      typeof value === "object" &&
      containsDirectAwait(value)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Collect the async function bodies of every `<expr>.action(async ...)` call.
 * Non-block bodies (implicit-return arrows like `.action(async () => run())`)
 * are included too: they structurally cannot contain a try-catch, so the
 * caller must flag them as missing the boundary rather than skip them.
 */
function findAsyncActionBodies(tree: EsTreeProgram): EsTreeNode[] {
  const bodies: EsTreeNode[] = [];
  walk(tree, (n) => {
    if (n.type !== "CallExpression") return;
    const callee = asEsTreeNode(n.callee);
    if (callee?.type !== "MemberExpression" || callee.computed === true) return;
    const property = asEsTreeNode(callee.property);
    if (property?.type !== "Identifier" || property.name !== "action") return;
    const handler = firstNode(n.arguments);
    if (
      (handler?.type !== "ArrowFunctionExpression" &&
        handler?.type !== "FunctionExpression") ||
      handler.async !== true
    ) {
      return;
    }
    const body = asEsTreeNode(handler.body);
    if (body) bodies.push(body);
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
    const candidate = calleeName(asEsTreeNode(n.argument));
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
        const files = ctx.scopedFiles.filter(
          (f) => f.includes("commands/") && !f.endsWith("index.ts")
        );

        const checks = files.map(async (file) => {
          let tree: EsTreeProgram;
          try {
            tree = await ctx.ast(file, "typescript");
          } catch (err) {
            // Surface parse failures instead of silently treating the file
            // as compliant — a transpiler edge case would otherwise mask
            // coverage loss for this file.
            ctx.report.warning({
              message: `Could not parse file for boundary analysis: ${
                err instanceof Error ? err.message : String(err)
              }`,
              file,
              fix: "Fix the parse error (or report it if the file is valid TypeScript) so ARCH-012 coverage analysis can run",
            });
            return;
          }
          // Read once per file, outside the bodies loop — used for line
          // lookup because AST loc refers to transpiled output (ARCH-022).
          const source = await ctx.readFile(file);

          for (const body of findAsyncActionBodies(tree)) {
            // Implicit-return arrow bodies (`async () => run()`) can never
            // contain a try-catch — an unavoidable missing boundary.
            if (body.type !== "BlockStatement") {
              ctx.report.warning({
                message:
                  "Async command action uses an implicit-return arrow body, which cannot contain a try-catch error boundary",
                file,
                fix: "Convert to a block body: .action(async (...) => { try { ... } catch (err) { await handleCommandError(err); } })",
              });
              continue;
            }
            const statements = asEsTreeNodeArray(body.body);
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
        const files = ctx.scopedFiles.filter(
          (f) => f.includes("commands/") && !f.endsWith("index.ts")
        );

        const checks = files.map(async (file) => {
          const content = await ctx.readFile(file);

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
