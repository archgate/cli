// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { z } from "zod";

import { parseJsModule, type MeriyahProgram } from "./js-parser";

/**
 * Module specifiers a rule file is permitted to import.
 *
 * This is an ALLOWLIST, and deliberately so. A denylist of "dangerous" modules
 * is not a viable boundary here: `.rules.ts` files are imported and executed
 * in-process by `archgate check`, so reaching *any* module outside this set is
 * arbitrary code execution, and the ways to name one are effectively unbounded
 * — `data:text/javascript,...` URLs, relative paths to files the scanner never
 * sees, bare npm packages, and `node:module`'s `createRequire` all resolve to
 * executable code without naming a banned builtin. Enumerating those is
 * unwinnable; enumerating the handful of safe modules is not.
 *
 * Only `node:`-prefixed specifiers are allowed. The bare forms (`path`) are
 * shadowable by a `node_modules/path` package in the *target* project, which
 * would hand execution straight back to the untrusted code this scanner exists
 * to contain; the `node:` scheme always resolves to the built-in.
 *
 * Type-only imports need no entry here — `Bun.Transpiler` erases them before
 * this scanner ever sees the AST.
 */
const ALLOWED_MODULES = new Set([
  "node:path",
  "node:url",
  "node:util",
  "node:crypto",
]);

/** Bun API properties that bypass the RuleContext sandbox. */
const BLOCKED_BUN_PROPS = new Set(["spawn", "spawnSync", "write", "$", "file"]);

/**
 * Property names that reach process internals or native code from any object
 * reference. Matched on the property name alone, regardless of what it is
 * accessed on: `process.binding(...)` and `globalThis.process.binding(...)`
 * are the same capability, and pinning the check to an object named `process`
 * only catches the first spelling.
 */
const BLOCKED_INTERNAL_PROPS = new Set(["binding", "_linkedBinding", "dlopen"]);

/**
 * Characters that let source render differently from how it parses.
 *
 * This is the one class of problem the AST cannot see, and the reason this
 * scanner also inspects raw text. The parser resolves the true meaning, so a
 * bidi override or an invisible character is invisible to it *by design*; the
 * target of the attack is the human reading the diff -- a reviewer approving an
 * imported rule pack -- not the parser. See "Trojan Source" (CVE-2021-42574).
 *
 * A denylist is legitimate here, unlike for module specifiers: this set is
 * closed by the Unicode specification rather than by our imagination.
 *
 * Keyed by code point on purpose. Spelling these as literal characters would
 * put the very things this scanner rejects into its own source, where no
 * reviewer could see them -- and writing them as escapes is not enough either,
 * since a formatter may normalise an escape back into the literal character.
 * (Drafting this comment did exactly that: a U+202E written as an escape came
 * back as an invisible override sitting in this paragraph.) A number cannot be
 * made invisible, so the code points are spelled numerically and never as text.
 */
const INVISIBLE_CHARS = new Map<number, string>([
  [0x202a, "LEFT-TO-RIGHT EMBEDDING"],
  [0x202b, "RIGHT-TO-LEFT EMBEDDING"],
  [0x202c, "POP DIRECTIONAL FORMATTING"],
  [0x202d, "LEFT-TO-RIGHT OVERRIDE"],
  [0x202e, "RIGHT-TO-LEFT OVERRIDE"],
  [0x2066, "LEFT-TO-RIGHT ISOLATE"],
  [0x2067, "RIGHT-TO-LEFT ISOLATE"],
  [0x2068, "FIRST STRONG ISOLATE"],
  [0x2069, "POP DIRECTIONAL ISOLATE"],
  [0x200b, "ZERO WIDTH SPACE"],
  [0x200c, "ZERO WIDTH NON-JOINER"],
  [0x200d, "ZERO WIDTH JOINER"],
  [0x200e, "LEFT-TO-RIGHT MARK"],
  [0x200f, "RIGHT-TO-LEFT MARK"],
  [0x061c, "ARABIC LETTER MARK"],
  [0x2060, "WORD JOINER"],
  [0x2061, "FUNCTION APPLICATION"],
  [0x2062, "INVISIBLE TIMES"],
  [0x2063, "INVISIBLE SEPARATOR"],
  [0x2064, "INVISIBLE PLUS"],
  [0xfeff, "ZERO WIDTH NO-BREAK SPACE"],
]);

/** Human-readable allowlist for violation messages. */
const ALLOWED_MODULES_TEXT = [...ALLOWED_MODULES].join(", ");

export interface ScanViolation {
  message: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

/**
 * Scan raw source text, before transpilation or parsing.
 *
 * This is deliberately NOT a text search for dangerous names. Such a search
 * would be strictly worse than the AST walk that follows it: the parser
 * resolves escapes, so `import("node:child_process")` is caught by the
 * module allowlist even though its raw text never contains the string
 * "node:child_process". A regex looking for that string would miss it. Text
 * matching also cannot tell code from data, and rule files legitimately
 * contain dangerous-looking strings as the patterns they search *for* —
 * ARCH-007's and ARCH-022's own rules mention `child_process` by name.
 *
 * What this pass catches is the one thing the AST cannot: characters that make
 * the rendered source differ from the parsed source. The AST is blind to them
 * because it sees the true program, which is exactly the point — the target is
 * the human reviewing an imported rule pack.
 */
function scanSourceText(source: string): ScanViolation[] {
  const violations: ScanViolation[] = [];
  let line = 1;
  let column = 0;

  for (const char of source) {
    if (char === "\n") {
      line++;
      column = 0;
      continue;
    }

    const codePoint = char.codePointAt(0) ?? 0;
    const name = INVISIBLE_CHARS.get(codePoint);
    // A BOM at the very start of the file is a normal encoding artifact, not
    // an attempt to hide anything.
    const isLeadingBom = codePoint === 0xfeff && line === 1 && column === 0;

    if (name !== undefined && !isLeadingBom) {
      const hex = codePoint.toString(16).toUpperCase().padStart(4, "0");
      violations.push({
        message: `Invisible character U+${hex} (${name}) is blocked in rule files — it can make the rendered source differ from the code that runs. Remove it.`,
        line,
        column,
        endLine: line,
        endColumn: column + 1,
      });
    }

    column += char.length;
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Zod schemas for ESTree AST nodes
// ---------------------------------------------------------------------------

interface AstNode {
  type: string;
  name?: string;
  value?: string | number | boolean | null | AstNode;
  computed?: boolean;
  source?: AstNode;
  object?: AstNode;
  property?: AstNode;
  callee?: AstNode;
  left?: AstNode;
  [key: string]: unknown;
}

const AstNodeSchema: z.ZodType<AstNode> = z
  .object({
    type: z.string(),
    name: z.string().optional(),
    value: z
      .union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.lazy(() => AstNodeSchema),
      ])
      .optional(),
    computed: z.boolean().optional(),
    source: z.lazy(() => AstNodeSchema).optional(),
    object: z.lazy(() => AstNodeSchema).optional(),
    property: z.lazy(() => AstNodeSchema).optional(),
    callee: z.lazy(() => AstNodeSchema).optional(),
    left: z.lazy(() => AstNodeSchema).optional(),
  })
  .passthrough();

/** Parse an unknown value into an AstNode, or return null. */
function parseNode(value: unknown): AstNode | null {
  const result = AstNodeSchema.safeParse(value);
  return result.success ? result.data : null;
}

import { remapViolations, type RawViolation } from "./source-positions";

/**
 * Scan a `.rules.ts` source string for banned patterns.
 *
 * Two passes, in this order:
 *
 * 1. **Raw text** (`scanSourceText`) — the source exactly as written, before
 *    any transformation, checked for characters that make the rendered code
 *    differ from the parsed code. This must run on the untransformed text:
 *    transpiling normalises some of what it looks for.
 * 2. **AST** — transpile TypeScript to JavaScript (`Bun.Transpiler`), parse to
 *    an ESTree tree (`meriyah`), and walk every node for blocked imports,
 *    globals, and escapes.
 *
 * The division is deliberate. The AST pass is the stronger of the two for
 * anything semantic, *including* obfuscation: the parser resolves escapes and
 * constant forms, so it sees `import("node:child_process")` however it is
 * spelled. Text matching is reserved for the one thing a parser cannot report,
 * because it is defined by what a human sees rather than what the code means.
 *
 * Returns an empty array if the rule is clean; violations if blocked patterns are found.
 */
/** Shared transpiler — stateless, safe to reuse across calls. */
const tsTranspiler = new Bun.Transpiler({ loader: "ts" });

export function scanRuleSource(
  source: string,
  preTranspiled?: string
): ScanViolation[] {
  // Runs first, on the untransformed source, and is carried through the parse
  // failure paths below: a file that does not parse is exactly where a hidden
  // character is most worth reporting.
  const textViolations = scanSourceText(source);

  let js: string;
  if (preTranspiled) {
    js = preTranspiled;
  } else {
    try {
      js = tsTranspiler.transformSync(source);
    } catch (err) {
      // Bun.Transpiler throws AggregateError for syntax errors in the source.
      // Return a single violation pointing at line 1 so the caller can report
      // the file as blocked rather than crashing.
      const msg =
        err instanceof AggregateError && err.errors.length > 0
          ? String(err.errors[0])
          : err instanceof Error
            ? err.message
            : String(err);
      return textViolations.concat({
        message: `Parse error: ${msg}`,
        line: 1,
        column: 0,
        endLine: 1,
        endColumn: 0,
      });
    }
  }

  let ast: MeriyahProgram;
  try {
    ast = parseJsModule(js);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return textViolations.concat({
      message: `Parse error: ${msg}`,
      line: 1,
      column: 0,
      endLine: 1,
      endColumn: 0,
    });
  }
  const rawViolations: RawViolation[] = [];

  /** Track how many times each searchText has been seen, to match by occurrence. */
  const seenCounts = new Map<string, number>();
  function pushViolation(message: string, searchText: string) {
    const count = seenCounts.get(searchText) ?? 0;
    seenCounts.set(searchText, count + 1);
    rawViolations.push({ message, searchText, occurrence: count });
  }

  /**
   * The property name a member expression reads, when it is knowable
   * statically — from `o.name` and from `o["name"]` alike.
   *
   * Both spellings are the same capability, so a check that only reads
   * `prop.name` sees the first and misses the second. `o[k]` with a computed
   * key returns undefined: unknowable here, and out of reach of a scanner that
   * does not track values (see ARCH-023 on the limits of the static boundary).
   */
  function staticPropName(
    prop: AstNode,
    computed: boolean
  ): string | undefined {
    if (!computed) return prop.name;
    return typeof prop.value === "string" ? prop.value : undefined;
  }

  /**
   * Enforce the module allowlist for any construct that names a module and
   * causes it to be evaluated. `import`, `export ... from`, and `export * from`
   * are all the same capability — a re-export executes the target module
   * exactly as an import does.
   */
  function checkModuleSpecifier(node: AstNode): void {
    const src =
      typeof node.source?.value === "string" ? node.source.value : undefined;
    if (src === undefined || ALLOWED_MODULES.has(src)) return;
    // Anchor on `from "module"` — `from` is in code context, whereas the bare
    // module string is inside a literal, which buildNonCodeRanges skips.
    pushViolation(
      `Import of "${src}" is blocked in rule files. Only ${ALLOWED_MODULES_TEXT} may be imported; use the RuleContext API for filesystem, subprocess, and network access.`,
      `from "${src}"`
    );
  }

  function walk(node: AstNode): void {
    if (!node || typeof node !== "object") return;

    switch (node.type) {
      // `export ... from "x"` / `export * from "x"` evaluate the target module
      // just as an import does, so they run through the same allowlist. Nodes
      // without a `source` (a plain local `export`) are ignored by the helper.
      case "ImportDeclaration":
      case "ExportNamedDeclaration":
      case "ExportAllDeclaration": {
        checkModuleSpecifier(node);
        break;
      }
      case "MemberExpression": {
        const obj = node.object;
        const prop = node.property;
        if (!obj || !prop) break;
        const computed = node.computed ?? false;

        // Block Bun.spawn, Bun.write, Bun.$, Bun.file, Bun.spawnSync.
        // Only the dotted spelling needs naming here: `Bun["spawn"]` is caught
        // by the blanket computed-access rule below, which is stricter.
        if (
          obj.name === "Bun" &&
          !computed &&
          BLOCKED_BUN_PROPS.has(prop.name ?? "")
        ) {
          pushViolation(
            `Bun.${prop.name}() is blocked in rule files. Use the RuleContext API instead.`,
            `Bun.${prop.name}`
          );
        }

        // Block computed access: Bun[x], globalThis[x]
        if (computed && (obj.name === "Bun" || obj.name === "globalThis")) {
          pushViolation(
            `Computed property access on ${obj.name} is blocked in rule files.`,
            `${obj.name}[`
          );
        }

        // Block process.binding / process.dlopen and friends, on any receiver
        // and in either spelling. Matching the property name rather than an
        // object named `process` is what catches an aliased receiver
        // (`const p = process; p.binding(...)`), and reading the key from a
        // computed literal is what catches `process["binding"](...)`.
        const propName = staticPropName(prop, computed);
        if (propName !== undefined && BLOCKED_INTERNAL_PROPS.has(propName)) {
          pushViolation(
            `.${propName}() is blocked in rule files — it reaches process internals and native code. Use the RuleContext API instead.`,
            computed ? `["${propName}"]` : `.${propName}`
          );
        }

        // Block `import.meta.require(...)` — a require() escape that names no
        // banned module and is not an ImportExpression.
        if (
          !computed &&
          obj.type === "MetaProperty" &&
          prop.name === "require"
        ) {
          pushViolation(
            "import.meta.require() is blocked in rule files. Use the RuleContext API instead.",
            "import.meta.require"
          );
        }
        break;
      }
      case "CallExpression": {
        const name = node.callee?.name;
        if (name === "eval") {
          pushViolation("eval() is blocked in rule files.", "eval(");
        }
        if (name === "Function") {
          pushViolation(
            "Function() constructor is blocked in rule files.",
            "Function("
          );
        }
        if (name === "fetch") {
          pushViolation(
            "fetch() is blocked in rule files. Rules should not make network requests.",
            "fetch("
          );
        }
        if (name === "require") {
          pushViolation(
            "require() is blocked in rule files. Use the RuleContext API instead.",
            "require("
          );
        }
        break;
      }
      case "NewExpression": {
        if (node.callee?.name === "Function") {
          pushViolation(
            "new Function() is blocked in rule files.",
            "new Function("
          );
        }
        break;
      }
      case "ImportExpression": {
        // A non-literal specifier cannot be checked against the allowlist at
        // scan time, so it is refused outright.
        if (node.source && node.source.type !== "Literal") {
          pushViolation(
            "Dynamic import() with non-literal argument is blocked in rule files.",
            "import("
          );
          break;
        }
        // A *literal* specifier must still clear the allowlist. This case
        // previously checked only for non-literal arguments, so the constant
        // form — `await import("node:child_process")` — was a complete bypass
        // of the module ban that ImportDeclaration enforces.
        const src =
          typeof node.source?.value === "string"
            ? node.source.value
            : undefined;
        if (src !== undefined && !ALLOWED_MODULES.has(src)) {
          // Anchor on `import(`, not the specifier: the literal is non-code to
          // the remapper, and `import(` survives arbitrary argument formatting.
          pushViolation(
            `Dynamic import of "${src}" is blocked in rule files. Only ${ALLOWED_MODULES_TEXT} may be imported; use the RuleContext API for filesystem, subprocess, and network access.`,
            "import("
          );
        }
        break;
      }
      case "AssignmentExpression": {
        const left = node.left;
        if (left && left.type === "MemberExpression") {
          if (left.object?.name === "globalThis") {
            pushViolation(
              "Mutating globalThis is blocked in rule files.",
              "globalThis."
            );
          }
          if (
            left.object?.name === "process" &&
            left.property?.name === "env"
          ) {
            const target = `${left.object.name}.${left.property.name}`;
            pushViolation(
              `Mutating ${target} is blocked in rule files.`,
              target
            );
          }
        }
        break;
      }
    }

    // Recurse into child nodes
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          const child = parseNode(item);
          if (child) walk(child);
        }
      } else {
        const child = parseNode(value);
        if (child) walk(child);
      }
    }
  }

  const root = parseNode(ast);
  if (root) walk(root);
  // Text-pass violations already carry true positions — they are found in the
  // original source, so they need no remapping back through the transpiler.
  return textViolations.concat(remapViolations(source, rawViolations));
}

/**
 * Extra patterns blocked for imported (untrusted) rule files.
 *
 * `require` is deliberately absent: `scanRuleSource()` now blocks it for every
 * rule file, first-party or not, and listing it here too would report the same
 * call twice.
 */
const IMPORTED_BLOCKED_GLOBALS = new Set(["WebSocket"]);

/**
 * Scan an imported (untrusted) `.rules.ts` source with stricter checks.
 *
 * Runs the standard `scanRuleSource()` first, then adds extra checks for
 * patterns that are acceptable in first-party rules but dangerous in
 * imported rules:
 *   - `Bun.env` access
 *   - environment variable reads via process
 *   - `require()` calls
 *   - `WebSocket` usage
 */
export function scanImportedRuleSource(source: string): ScanViolation[] {
  let js: string;
  try {
    js = tsTranspiler.transformSync(source);
  } catch (err) {
    const msg =
      err instanceof AggregateError && err.errors.length > 0
        ? String(err.errors[0])
        : err instanceof Error
          ? err.message
          : String(err);
    return [
      {
        message: `Parse error: ${msg}`,
        line: 1,
        column: 0,
        endLine: 1,
        endColumn: 0,
      },
    ];
  }

  let ast: MeriyahProgram;
  try {
    ast = parseJsModule(js);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return [
      {
        message: `Parse error: ${msg}`,
        line: 1,
        column: 0,
        endLine: 1,
        endColumn: 0,
      },
    ];
  }
  const rawViolations: RawViolation[] = [];

  const seenCounts = new Map<string, number>();
  function pushViolation(message: string, searchText: string) {
    const count = seenCounts.get(searchText) ?? 0;
    seenCounts.set(searchText, count + 1);
    rawViolations.push({ message, searchText, occurrence: count });
  }

  function walkImported(node: AstNode): void {
    if (!node || typeof node !== "object") return;

    switch (node.type) {
      case "MemberExpression": {
        const obj = node.object;
        const prop = node.property;
        if (!obj || !prop) break;
        const computed = node.computed ?? false;

        // Block Bun.env
        if (obj.name === "Bun" && !computed && prop.name === "env") {
          pushViolation(
            "Bun.env access is blocked in imported rule files.",
            "Bun.env"
          );
        }

        // Block process env reads
        if (obj.name === "process" && !computed && prop.name === "env") {
          const target = `${obj.name}.${prop.name}`;
          pushViolation(
            `${target} access is blocked in imported rule files.`,
            target
          );
        }
        break;
      }
      case "CallExpression": {
        const name = node.callee?.name;
        if (name && IMPORTED_BLOCKED_GLOBALS.has(name)) {
          pushViolation(
            `${name}() is blocked in imported rule files.`,
            `${name}(`
          );
        }
        break;
      }
      case "NewExpression": {
        const name = node.callee?.name;
        if (name && IMPORTED_BLOCKED_GLOBALS.has(name)) {
          pushViolation(
            `new ${name}() is blocked in imported rule files.`,
            `new ${name}(`
          );
        }
        break;
      }
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          const child = parseNode(item);
          if (child) walkImported(child);
        }
      } else {
        const child = parseNode(value);
        if (child) walkImported(child);
      }
    }
  }

  const importedRoot = parseNode(ast);
  if (importedRoot) walkImported(importedRoot);

  // Combine: standard scan + imported-only scan (reuse transpiled JS)
  const standardViolations = scanRuleSource(source, js);
  const importedViolations = remapViolations(source, rawViolations);
  return standardViolations.concat(importedViolations);
}
