// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { parseModule } from "meriyah";

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

interface AstLoc {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

interface AstNode {
  type: string;
  loc?: AstLoc;
  [key: string]: unknown;
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
export function scanRuleSource(source: string): ScanViolation[] {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const js = transpiler.transformSync(source);
  const ast = parseModule(js, { next: true, loc: true, module: true });
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
        const src = (node.source as { value: string }).value;
        if (BANNED_MODULES.test(src) || src === "bun") {
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
        const obj = node.object as AstNode & { name?: string };
        const prop = node.property as AstNode & { name?: string };
        const computed = node.computed as boolean;

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
        const callee = node.callee as AstNode & { name?: string };
        if (callee.name === "eval") {
          pushViolation("eval() is blocked in rule files.", "eval(");
        }
        if (callee.name === "Function") {
          pushViolation(
            "Function() constructor is blocked in rule files.",
            "Function("
          );
        }
        if (callee.name === "fetch") {
          pushViolation(
            "fetch() is blocked in rule files. Rules should not make network requests.",
            "fetch("
          );
        }
        break;
      }
      case "NewExpression": {
        const callee = node.callee as AstNode & { name?: string };
        if (callee.name === "Function") {
          pushViolation(
            "new Function() is blocked in rule files.",
            "new Function("
          );
        }
        break;
      }
      case "ImportExpression": {
        const src = node.source as AstNode;
        if (src.type !== "Literal") {
          pushViolation(
            "Dynamic import() with non-literal argument is blocked in rule files.",
            "import("
          );
        }
        break;
      }
      case "AssignmentExpression": {
        const left = node.left as AstNode & {
          object?: AstNode & { name?: string };
          property?: AstNode & { name?: string };
        };
        if (left.type === "MemberExpression") {
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
          if (item && typeof item === "object" && (item as AstNode).type) {
            walk(item as AstNode);
          }
        }
      } else if (
        value &&
        typeof value === "object" &&
        (value as AstNode).type
      ) {
        walk(value as AstNode);
      }
    }
  }

  walk(ast as unknown as AstNode);
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
 *
 * @internal
 */
export function scanImportedRuleSource(source: string): ScanViolation[] {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const js = transpiler.transformSync(source);
  const ast = parseModule(js, { next: true, loc: true, module: true });
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
        const obj = node.object as AstNode & { name?: string };
        const prop = node.property as AstNode & { name?: string };
        const computed = node.computed as boolean;

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
        const callee = node.callee as AstNode & { name?: string };
        if (callee.name && IMPORTED_BLOCKED_GLOBALS.has(callee.name)) {
          pushViolation(
            `${callee.name}() is blocked in imported rule files.`,
            `${callee.name}(`
          );
        }
        break;
      }
      case "NewExpression": {
        const callee = node.callee as AstNode & { name?: string };
        if (callee.name && IMPORTED_BLOCKED_GLOBALS.has(callee.name)) {
          pushViolation(
            `new ${callee.name}() is blocked in imported rule files.`,
            `new ${callee.name}(`
          );
        }
        break;
      }
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object" && (item as AstNode).type) {
            walkImported(item as AstNode);
          }
        }
      } else if (
        value &&
        typeof value === "object" &&
        (value as AstNode).type
      ) {
        walkImported(value as AstNode);
      }
    }
  }

  walkImported(ast as unknown as AstNode);

  // Combine: standard scan + imported-only scan
  const standardViolations = scanRuleSource(source);
  const importedViolations = remapViolations(source, rawViolations);
  return [...standardViolations, ...importedViolations];
}
