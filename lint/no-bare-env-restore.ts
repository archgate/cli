// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// Custom oxlint JS plugin: tests must restore environment variables via
// `restoreEnv()` (tests/test-utils.ts), never a bare `Bun.env.X = original` —
// it assigns the STRING "undefined" instead of unsetting the key, leaking
// it into every later test file (ARCH-005). Tracks each binding's captured
// env key through a scope tree, not identifier-name matching (archgate/cli#498).

/** Minimal ESTree-ish node shape. The oxlint AST is ESLint-compatible. */
type AstNode = { type: string } & Record<string, unknown>;

function asNode(value: unknown): AstNode | undefined {
  if (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { type?: unknown }).type === "string"
  ) {
    return value as AstNode;
  }
  return undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The identifier name of a non-computed member property, e.g. `HOME` in `Bun.env.HOME`. */
function staticPropertyName(node: AstNode): string | undefined {
  if (node.computed === true) return undefined;
  const property = asNode(node.property);
  if (property?.type === "Identifier" && typeof property.name === "string") {
    return property.name;
  }
  return undefined;
}

/**
 * Read the variable name off a dotted env access — `Bun.env.NAME` or
 * `process.env.NAME`.
 *
 * @returns The accessed name (`NAME`), or undefined when the node is not a
 * dotted env access. Computed access (`Bun.env[key]`) deliberately returns
 * undefined: a dynamic key is the shape of a generic helper such as
 * `restoreEnv` itself, not the hand-rolled capture-and-restore idiom this
 * rule targets.
 */
function envVarName(node: AstNode | undefined): string | undefined {
  if (node?.type !== "MemberExpression") return undefined;
  const name = staticPropertyName(node);
  if (name === undefined) return undefined;

  const object = asNode(node.object);
  if (object?.type !== "MemberExpression") return undefined;
  if (staticPropertyName(object) !== "env") return undefined;

  const base = asNode(object.object);
  if (base?.type !== "Identifier") return undefined;
  return base.name === "Bun" || base.name === "process" ? name : undefined;
}

/** A local binding's captured env key, if it currently holds a value read from `Bun.env`/`process.env`. */
interface Binding {
  envKey: string | undefined;
}

/** A lexical scope: function/program bodies host `var`, every block hosts `let`/`const`. */
interface Scope {
  parent: Scope | undefined;
  isVarScope: boolean;
  bindings: Map<string, Binding>;
}

function newScope(parent: Scope | undefined, isVarScope: boolean): Scope {
  return { parent, isVarScope, bindings: new Map() };
}

/** Walk outward to the nearest function/program scope — where a `var` declaration actually lives, regardless of how many blocks lexically enclose it. */
function nearestVarScope(scope: Scope): Scope {
  let current = scope;
  while (!current.isVarScope && current.parent) {
    current = current.parent;
  }
  return current;
}

/** Declare `name` in `scope`, reusing an existing binding for a duplicate declaration in the same scope (e.g. a twice-declared `var`) rather than discarding its already-captured key. */
function declare(scope: Scope, name: string): Binding {
  let binding = scope.bindings.get(name);
  if (!binding) {
    binding = { envKey: undefined };
    scope.bindings.set(name, binding);
  }
  return binding;
}

/** Resolve `name` to its nearest declaring binding, walking outward through enclosing scopes — `undefined` for an unresolved (e.g. implicit global) identifier. */
function resolve(scope: Scope, name: string): Binding | undefined {
  let current: Scope | undefined = scope;
  while (current) {
    const binding = current.bindings.get(name);
    if (binding) return binding;
    current = current.parent;
  }
  return undefined;
}

/**
 * Record `binding` as env-captured from `init`, when `init` is a dotted env
 * access. Never overwrites an already-captured key — this only needs to
 * answer "was this binding ever captured, and from which key."
 */
function captureIfEnv(binding: Binding, init: AstNode | undefined): void {
  const key = envVarName(init);
  if (key !== undefined && binding.envKey === undefined) {
    binding.envKey = key;
  }
}

/** Every Identifier name bound by a (possibly destructured) binding pattern. */
function collectPatternNames(
  pattern: AstNode | undefined,
  out: string[]
): void {
  if (!pattern) return;
  switch (pattern.type) {
    case "Identifier":
      if (typeof pattern.name === "string") out.push(pattern.name);
      return;
    case "AssignmentPattern":
      collectPatternNames(asNode(pattern.left), out);
      return;
    case "RestElement":
      collectPatternNames(asNode(pattern.argument), out);
      return;
    case "ObjectPattern":
      for (const prop of asArray(pattern.properties)) {
        const p = asNode(prop);
        if (!p) continue;
        collectPatternNames(
          asNode(p.type === "RestElement" ? p.argument : p.value),
          out
        );
      }
      return;
    case "ArrayPattern":
      for (const element of asArray(pattern.elements)) {
        collectPatternNames(asNode(element), out);
      }
  }
}

function declarePattern(scope: Scope, pattern: AstNode | undefined): void {
  const names: string[] = [];
  collectPatternNames(pattern, names);
  for (const name of names) declare(scope, name);
}

/** A `env.TARGET = <ident>` assignment, awaiting resolution once the whole tree — and every binding's captured key — has been walked. */
interface RestoreCandidate {
  node: AstNode;
  targetKey: string;
  rhsName: string;
  scope: Scope;
}

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

/**
 * Walk the whole program once, building a lexical scope tree and collecting
 * every `env.TARGET = <ident>` assignment as a candidate. Candidates are
 * resolved only after the full walk completes, so capture order within a
 * file (e.g. a capture that lexically follows its restore) does not matter.
 */
function analyze(root: AstNode): RestoreCandidate[] {
  const candidates: RestoreCandidate[] = [];
  const rootScope = newScope(undefined, true);

  function genericDescend(node: AstNode, scope: Scope): void {
    for (const key of Object.keys(node)) {
      if (key === "parent" || key === "loc" || key === "range") continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          const child = asNode(item);
          if (child) visit(child, scope);
        }
      } else {
        const child = asNode(value);
        if (child) visit(child, scope);
      }
    }
  }

  function visit(node: AstNode, scope: Scope): void {
    if (FUNCTION_TYPES.has(node.type)) {
      const fnScope = newScope(scope, true);
      for (const param of asArray(node.params)) {
        declarePattern(fnScope, asNode(param));
      }
      const body = asNode(node.body);
      if (body) visit(body, fnScope);
      return;
    }

    if (node.type === "BlockStatement") {
      const blockScope = newScope(scope, false);
      genericDescend(node, blockScope);
      return;
    }

    if (node.type === "CatchClause") {
      const catchScope = newScope(scope, false);
      const param = asNode(node.param);
      if (param) declarePattern(catchScope, param);
      const body = asNode(node.body);
      if (body) visit(body, catchScope);
      return;
    }

    if (node.type === "VariableDeclaration") {
      const targetScope = node.kind === "var" ? nearestVarScope(scope) : scope;
      for (const declarator of asArray(node.declarations)) {
        const decl = asNode(declarator);
        if (!decl) continue;
        const id = asNode(decl.id);
        const init = asNode(decl.init);
        if (id?.type === "Identifier" && typeof id.name === "string") {
          captureIfEnv(declare(targetScope, id.name), init);
        } else {
          declarePattern(targetScope, id);
        }
        if (init) visit(init, scope);
      }
      return;
    }

    if (node.type === "AssignmentExpression" && node.operator === "=") {
      const left = asNode(node.left);
      const right = asNode(node.right);
      const targetKey = envVarName(left);
      if (
        targetKey !== undefined &&
        right?.type === "Identifier" &&
        typeof right.name === "string"
      ) {
        candidates.push({ node, targetKey, rhsName: right.name, scope });
      } else if (left?.type === "Identifier" && typeof left.name === "string") {
        // A plain `x = Bun.env.Y` reassignment updates whichever binding `x`
        // already resolves to (e.g. an outer `let` captured from inside a
        // nested `beforeEach`), falling back to a root-scope binding for an
        // unresolved (implicit global) identifier.
        captureIfEnv(
          resolve(scope, left.name) ?? declare(rootScope, left.name),
          right
        );
      }
      if (left) visit(left, scope);
      if (right) visit(right, scope);
      return;
    }

    genericDescend(node, scope);
  }

  visit(root, rootScope);
  return candidates;
}

interface ReportDescriptor {
  node: AstNode;
  message: string;
}

interface RuleContext {
  report(descriptor: ReportDescriptor): void;
}

function message(varName: string, rhs: string): string {
  return `Restore \`${varName}\` with \`restoreEnv("${varName}", ${rhs})\` from tests/test-utils.ts instead of assigning it back directly. \`env.${varName} = ${rhs}\` sets the string "undefined" when ${rhs} is undefined rather than unsetting the key, leaking it into every later test file (ARCH-005).`;
}

const noBareEnvRestore = {
  create(context: RuleContext) {
    return {
      Program(node: AstNode) {
        for (const candidate of analyze(node)) {
          const binding = resolve(candidate.scope, candidate.rhsName);
          if (binding?.envKey !== candidate.targetKey) continue;
          context.report({
            node: candidate.node,
            message: message(candidate.targetKey, candidate.rhsName),
          });
        }
      },
    };
  },
};

const plugin = {
  meta: { name: "test-isolation" },
  rules: { "no-bare-env-restore": noBareEnvRestore },
};

export default plugin;
