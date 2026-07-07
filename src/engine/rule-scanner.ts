// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { z } from "zod";

import { parseJsModule, type MeriyahProgram } from "./js-parser";

/**
 * Banned module pattern — matches dangerous Node.js/Bun built-in modules
 * that provide filesystem, network, process, or VM capabilities.
 *
 * Safe modules NOT blocked: node:path, node:url, node:util, node:crypto
 */
const BANNED_MODULES =
  /^(node:)?(fs|child_process|net|dgram|http|https|http2|worker_threads|cluster|vm)(\/.*)?$/u;

/** Bun API properties that bypass the RuleContext sandbox. */
const BLOCKED_BUN_PROPS = new Set(["spawn", "spawnSync", "write", "$", "file"]);

export interface ScanViolation {
  message: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
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
 * The scanner transpiles TypeScript to JavaScript (via Bun.Transpiler),
 * parses the result into an ESTree AST (via meriyah), and walks every
 * node looking for dangerous imports, globals, and obfuscation patterns.
 *
 * Returns an empty array if the rule is clean; violations if blocked patterns are found.
 */
/** Shared transpiler — stateless, safe to reuse across calls. */
const tsTranspiler = new Bun.Transpiler({ loader: "ts" });

export function scanRuleSource(
  source: string,
  preTranspiled?: string
): ScanViolation[] {
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

  /** Track how many times each searchText has been seen, to match by occurrence. */
  const seenCounts = new Map<string, number>();
  function pushViolation(message: string, searchText: string) {
    const count = seenCounts.get(searchText) ?? 0;
    seenCounts.set(searchText, count + 1);
    rawViolations.push({ message, searchText, occurrence: count });
  }

  function walk(node: AstNode): void {
    if (!node || typeof node !== "object") return;

    switch (node.type) {
      case "ImportDeclaration": {
        const src =
          typeof node.source?.value === "string"
            ? node.source.value
            : undefined;
        if (src && (BANNED_MODULES.test(src) || src === "bun")) {
          // Use `from "module"` as search anchor — `from` is in code context
          // (unlike the bare module string which buildNonCodeRanges marks as non-code).
          pushViolation(
            `Import of "${src}" is blocked in rule files. Use the RuleContext API instead.`,
            `from "${src}"`
          );
        }
        break;
      }
      case "MemberExpression": {
        const obj = node.object;
        const prop = node.property;
        if (!obj || !prop) break;
        const computed = node.computed ?? false;

        // Block Bun.spawn, Bun.write, Bun.$, Bun.file, Bun.spawnSync
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
        if (node.source && node.source.type !== "Literal") {
          pushViolation(
            "Dynamic import() with non-literal argument is blocked in rule files.",
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
  return remapViolations(source, rawViolations);
}

/** Extra patterns blocked for imported (untrusted) rule files. */
const IMPORTED_BLOCKED_GLOBALS = new Set(["require", "WebSocket"]);

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
