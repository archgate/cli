// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// Custom oxlint JS plugin: validate `type:` literals passed to
// inquirer.prompt() against the prompt types registered by the installed
// inquirer version.
//
// Why this exists: inquirer v14 removed the legacy "list" prompt type
// (renamed "select" in v10), which crashed `archgate login` at runtime with
// 'Prompt type "list" is not registered'. Nothing else can catch this class
// of bug statically or in CI:
//   - tsc cannot: inquirer's legacy prompt() types accept ANY `type: string`
//     via the CustomQuestion escape hatch that exists for registerPrompt().
//   - tests cannot: interactive prompts need a TTY, so every test mocks the
//     inquirer module entirely and the runtime prompt registry never runs.
// The invariant is purely syntactic, so it belongs in the linter.
//
// The registered set is read from the installed inquirer at plugin load, so
// the rule self-updates on dependency bumps — a future rename/removal makes
// stale call sites fail lint in the bump PR itself.
//
// The plugin runs natively as TypeScript under Bun, so there is no build step.

/** Minimal ESTree-ish node shape. The oxlint AST is ESLint-compatible. */
type AstNode = { type: string } & Record<string, unknown>;

/** Narrow an unknown value to an AST node (an object with a string `type`). */
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

/**
 * Prompt types registered by the INSTALLED inquirer, read at plugin load.
 *
 * Deliberately not a hardcoded allowlist: when a future inquirer version
 * renames or removes a prompt type (as v10 did with "list" -> "select"),
 * the registry shrinks and stale call sites fail `bun run lint` immediately
 * in the dependency-bump PR — no manual list maintenance.
 *
 * If inquirer ever changes the registry's API shape, the loud throw below
 * fails the whole lint run rather than silently disabling the rule.
 */
const { default: inquirer } = await import("inquirer");
const REGISTERED_PROMPT_TYPES = new Set(Object.keys(inquirer.prompt.prompts));
if (REGISTERED_PROMPT_TYPES.size === 0) {
  throw new Error(
    "archgate/valid-inquirer-prompt-type: inquirer.prompt.prompts is empty — the registry API may have changed; update .archgate/lint/oxlint.ts"
  );
}

/** True when the callee is exactly `inquirer.prompt`. */
function isInquirerPromptCallee(callee: AstNode | undefined): boolean {
  if (callee?.type !== "MemberExpression") return false;
  const object = asNode(callee.object);
  const property = asNode(callee.property);
  return (
    object?.type === "Identifier" &&
    object.name === "inquirer" &&
    property?.type === "Identifier" &&
    property.name === "prompt"
  );
}

/**
 * Collect the question ObjectExpressions from inquirer.prompt() arguments.
 * Handles both the single-object form `prompt({...})` and the array form
 * `prompt([{...}, {...}])`.
 */
function questionObjects(args: unknown): AstNode[] {
  const result: AstNode[] = [];
  const list = Array.isArray(args) ? args : [];
  for (const arg of list) {
    const node = asNode(arg);
    if (node?.type === "ObjectExpression") {
      result.push(node);
    } else if (node?.type === "ArrayExpression") {
      const elements = Array.isArray(node.elements) ? node.elements : [];
      for (const element of elements) {
        const child = asNode(element);
        if (child?.type === "ObjectExpression") result.push(child);
      }
    }
  }
  return result;
}

/** Find the value node of the `type` property in a question object, if any. */
function typeValueNode(question: AstNode): AstNode | undefined {
  const properties = Array.isArray(question.properties)
    ? question.properties
    : [];
  for (const item of properties) {
    const property = asNode(item);
    if (property?.type !== "Property") continue;
    const key = asNode(property.key);
    const keyName =
      key?.type === "Identifier"
        ? key.name
        : key?.type === "Literal"
          ? key.value
          : undefined;
    if (keyName !== "type") continue;
    return asNode(property.value);
  }
  return undefined;
}

interface ReportDescriptor {
  node: AstNode;
  message: string;
}

interface RuleContext {
  report(descriptor: ReportDescriptor): void;
}

const validInquirerPromptType = {
  create(context: RuleContext) {
    return {
      CallExpression(node: AstNode) {
        if (!isInquirerPromptCallee(asNode(node.callee))) return;

        for (const question of questionObjects(node.arguments)) {
          const value = typeValueNode(question);
          if (value?.type !== "Literal" || typeof value.value !== "string")
            continue;
          if (REGISTERED_PROMPT_TYPES.has(value.value)) continue;

          context.report({
            node: value,
            message: `Prompt type "${value.value}" is not registered in the installed inquirer and will crash at runtime. Registered types: ${[...REGISTERED_PROMPT_TYPES].join(", ")}. (The legacy "list" type was renamed "select" in inquirer v10.)`,
          });
        }
      },
    };
  },
};

const plugin = {
  meta: { name: "archgate" },
  rules: { "valid-inquirer-prompt-type": validInquirerPromptType },
};

export default plugin;
