// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// Custom oxlint JS plugin: a loop must not stand in for `test.each()` and
// must not carry a test's only assertions (ARCH-025). Reports three shapes:
// a registration inside a loop, `expect()` over rows that exist at
// registration time, and a loop holding every `expect()` of a test.

/** Minimal ESTree-ish node shape. The oxlint AST is ESLint-compatible. */
type AstNode = { type: string } & Record<string, unknown>;

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}

function asNode(value: unknown): AstNode | undefined {
  return isAstNode(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const MODIFIERS: ReadonlySet<string> = new Set([
  "skip",
  "only",
  "todo",
  "skipIf",
  "runIf",
  "todoIf",
  "each",
  "concurrent",
  "failing",
  "if",
]);

/**
 * The bare identifier a registration callee is rooted at: `test`, `it` or
 * `describe`, reached only through bun:test modifier members and call links
 * (`test.skipIf(c)`, `test.each(rows)`). Any other member (`it.run`,
 * `test.tests`) is not a registration.
 */
function registrationRoot(node: AstNode | undefined): string | undefined {
  let current = node;
  while (current) {
    switch (current.type) {
      case "Identifier": {
        return typeof current.name === "string" &&
          (current.name === "test" ||
            current.name === "it" ||
            current.name === "describe")
          ? current.name
          : undefined;
      }
      case "MemberExpression": {
        const property = asNode(current.property);
        if (
          current.computed === true ||
          property?.type !== "Identifier" ||
          typeof property.name !== "string" ||
          !MODIFIERS.has(property.name)
        ) {
          return undefined;
        }
        current = asNode(current.object);
        break;
      }
      case "CallExpression": {
        current = asNode(current.callee);
        break;
      }
      default: {
        return undefined;
      }
    }
  }
  return undefined;
}

const TS_WRAPPERS: ReadonlySet<string> = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
]);

/** Strip TypeScript wrappers (`as`, `satisfies`, `!`, `<T>`) that hide a literal. */
function unwrap(node: AstNode | undefined): AstNode | undefined {
  let current = node;
  while (current && TS_WRAPPERS.has(current.type)) {
    current = asNode(current.expression);
  }
  return current;
}

/** Child nodes of an AST node, skipping back-references and locations. */
function childNodes(node: AstNode): AstNode[] {
  const out: AstNode[] = [];
  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "loc" || key === "range") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        const child = asNode(item);
        if (child) out.push(child);
      }
    } else {
      const child = asNode(value);
      if (child) out.push(child);
    }
  }
  return out;
}

function isFunction(node: AstNode | undefined): boolean {
  return (
    node?.type === "ArrowFunctionExpression" ||
    node?.type === "FunctionExpression"
  );
}

function isFunctionScope(node: AstNode): boolean {
  return isFunction(node) || node.type === "FunctionDeclaration";
}

/** A non-empty array literal; `[]` is a runtime accumulator, not a row table. */
function isRowTable(node: AstNode | undefined): boolean {
  const array = unwrap(node);
  return (
    array?.type === "ArrayExpression" && asArray(array.elements).length > 0
  );
}

/**
 * Names bound by `const NAME = [row, ...]` in `root`'s own scope. Nested
 * functions are skipped, except the callbacks of `describe()` calls when
 * `intoDescribe` is set, since a data table declared in a describe block is
 * visible to every test below it.
 */
function collectStaticArrays(
  root: AstNode,
  intoDescribe: boolean
): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: AstNode, entered: boolean): void => {
    if (isFunctionScope(node) && !entered) return;
    if (node.type === "VariableDeclaration" && node.kind === "const") {
      for (const item of asArray(node.declarations)) {
        const declarator = asNode(item);
        const id = asNode(declarator?.id);
        if (
          id?.type === "Identifier" &&
          typeof id.name === "string" &&
          isRowTable(asNode(declarator?.init))
        ) {
          names.add(id.name);
        }
      }
    }
    const describeCall =
      intoDescribe &&
      node.type === "CallExpression" &&
      registrationRoot(asNode(node.callee)) === "describe";
    for (const child of childNodes(node)) {
      visit(child, describeCall && isFunction(child));
    }
  };
  visit(root, true);
  return names;
}

/** True for a non-empty array literal or an identifier bound to one by `const`. */
function isStaticRows(
  node: AstNode | undefined,
  staticArrays: ReadonlySet<string>
): boolean {
  const target = unwrap(node);
  if (!target) return false;
  if (target.type === "ArrayExpression") return isRowTable(target);
  return (
    target.type === "Identifier" &&
    typeof target.name === "string" &&
    staticArrays.has(target.name)
  );
}

const ITERATION_METHODS: ReadonlySet<string> = new Set([
  "forEach",
  "map",
  "flatMap",
  "filter",
  "some",
  "every",
]);

/** The receiver of a `<receiver>.forEach/map/...(...)` call, or undefined for any other call. */
function iterationReceiver(call: AstNode): AstNode | undefined {
  const callee = asNode(call.callee);
  if (callee?.type !== "MemberExpression" || callee.computed === true) {
    return undefined;
  }
  const property = asNode(callee.property);
  return property?.type === "Identifier" &&
    typeof property.name === "string" &&
    ITERATION_METHODS.has(property.name)
    ? asNode(callee.object)
    : undefined;
}

/** `expect(...)`, `expect.soft(...)`, `expect.assertions(...)`: not the outer `.toBe()` link. */
function isExpectCall(callee: AstNode | undefined): boolean {
  if (callee?.type === "Identifier") return callee.name === "expect";
  if (callee?.type !== "MemberExpression") return false;
  const object = asNode(callee.object);
  return object?.type === "Identifier" && object.name === "expect";
}

interface ReportDescriptor {
  node: AstNode;
  message: string;
}

interface RuleContext {
  report(descriptor: ReportDescriptor): void;
}

interface ExpectSite {
  /** Enclosing loops inside the test callback, outermost first. */
  loops: AstNode[];
}

interface TestRecord {
  expects: ExpectSite[];
  /** Static row tables visible to this test callback. */
  statics: ReadonlySet<string>;
}

interface WalkContext {
  loops: AstNode[];
  test: TestRecord | undefined;
}

const LOOP_TYPES: ReadonlySet<string> = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
]);

const LOOP_REGISTRATION_MESSAGE =
  "`test()`/`it()`/`describe()` is registered inside a loop. Use `test.each()`/`describe.each()` so each case is its own named test (ARCH-025).";
const STATIC_ROWS_MESSAGE =
  "`expect()` runs once per iteration over rows that exist at registration time. Use `test.each(rows)` so each row is its own named test (ARCH-025).";
const ONLY_ASSERTIONS_MESSAGE =
  "This loop carries the test's only `expect()` calls, so an empty collection asserts nothing. Assert the collection itself (`toEqual([...])`, `toHaveLength(n)`) outside the loop (ARCH-025).";

const noLoopTestCases = {
  create(context: RuleContext) {
    return {
      Program(root: AstNode) {
        const moduleStatics = collectStaticArrays(root, true);
        // The inner call of `test.each(rows)(name, fn)` is the callee of the
        // outer one; only the outer call is a registration.
        const innerCalls = new Set<AstNode>();

        const finishTest = (record: TestRecord): void => {
          const isStaticLoop = (loop: AstNode): boolean =>
            (loop.type === "ForOfStatement" &&
              isStaticRows(asNode(loop.right), record.statics)) ||
            (loop.type === "CallExpression" &&
              isStaticRows(iterationReceiver(loop), record.statics));
          const reported = new Set<AstNode>();
          for (const site of record.expects) {
            const staticLoop = site.loops.find(isStaticLoop);
            if (staticLoop && !reported.has(staticLoop)) {
              reported.add(staticLoop);
              context.report({
                node: staticLoop,
                message: STATIC_ROWS_MESSAGE,
              });
            }
          }
          if (record.expects.some((site) => site.loops.length === 0)) return;
          for (const site of record.expects) {
            if (site.loops.some((loop) => reported.has(loop))) continue;
            const outermost = site.loops.at(0);
            if (!outermost) continue;
            reported.add(outermost);
            context.report({
              node: outermost,
              message: ONLY_ASSERTIONS_MESSAGE,
            });
          }
        };

        const visit = (node: AstNode, ctx: WalkContext): void => {
          if (LOOP_TYPES.has(node.type)) {
            const inner = { ...ctx, loops: [...ctx.loops, node] };
            for (const child of childNodes(node)) visit(child, inner);
            return;
          }
          if (node.type !== "CallExpression") {
            for (const child of childNodes(node)) visit(child, ctx);
            return;
          }

          const callee = asNode(node.callee);
          if (callee?.type === "CallExpression") innerCalls.add(callee);

          if (isExpectCall(callee) && ctx.test) {
            ctx.test.expects.push({ loops: ctx.loops });
          }

          const base = registrationRoot(callee);
          if (!innerCalls.has(node) && base !== undefined) {
            if (ctx.loops.length > 0) {
              context.report({ node, message: LOOP_REGISTRATION_MESSAGE });
            }
            const callback = asArray(node.arguments)
              .map((arg) => asNode(arg))
              .find((arg) => isFunction(arg));
            const record: TestRecord | undefined =
              base === "describe" || !callback
                ? undefined
                : {
                    expects: [],
                    statics: new Set([
                      ...moduleStatics,
                      ...collectStaticArrays(callback, false),
                    ]),
                  };
            for (const child of childNodes(node)) {
              visit(
                child,
                child === callback ? { loops: [], test: record } : ctx
              );
            }
            if (record) finishTest(record);
            return;
          }

          const callback = iterationReceiver(node)
            ? asNode(asArray(node.arguments)[0])
            : undefined;
          for (const child of childNodes(node)) {
            visit(
              child,
              child === callback && isFunction(callback)
                ? { ...ctx, loops: [...ctx.loops, node] }
                : ctx
            );
          }
        };

        visit(root, { loops: [], test: undefined });
      },
    };
  },
};

const plugin = {
  meta: { name: "test-cases" },
  rules: { "no-loop-test-cases": noLoopTestCases },
};

export default plugin;
