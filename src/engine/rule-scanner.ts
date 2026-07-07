// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
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

interface AstLoc {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

interface AstNode {
  type: string;
  loc?: AstLoc;
  [key: string]: unknown;
}

/** Runtime check: is `value` an AST node (has a `type` string property)? */
function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}

/** Narrow an AST child property to an AstNode, or null. */
function childNode(value: unknown): AstNode | null {
  return isAstNode(value) ? value : null;
}

/** Read a string-valued property from an AST node, or undefined. */
function strProp(node: AstNode, key: string): string | undefined {
  const v = node[key];
  return typeof v === "string" ? v : undefined;
}

/** Read a boolean-valued property from an AST node (defaults to false). */
function boolProp(node: AstNode, key: string): boolean {
  return node[key] === true;
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
  let js: string;
  try {
    js = transpiler.transformSync(source);
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
        const srcNode = childNode(node.source);
        const src = srcNode ? strProp(srcNode, "value") : undefined;
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
        const obj = childNode(node.object);
        const prop = childNode(node.property);
        if (!obj || !prop) break;
        const computed = boolProp(node, "computed");
        const objName = strProp(obj, "name");
        const propName = strProp(prop, "name");

        // Block Bun.spawn, Bun.write, Bun.$, Bun.file, Bun.spawnSync
        if (
          objName === "Bun" &&
          !computed &&
          BLOCKED_BUN_PROPS.has(propName ?? "")
        ) {
          pushViolation(
            `Bun.${propName}() is blocked in rule files. Use the RuleContext API instead.`,
            `Bun.${propName}`
          );
        }

        // Block computed access: Bun[x], globalThis[x]
        if (computed && (objName === "Bun" || objName === "globalThis")) {
          pushViolation(
            `Computed property access on ${objName} is blocked in rule files.`,
            `${objName}[`
          );
        }
        break;
      }
      case "CallExpression": {
        const callee = childNode(node.callee);
        const name = callee ? strProp(callee, "name") : undefined;
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
        const callee = childNode(node.callee);
        const name = callee ? strProp(callee, "name") : undefined;
        if (name === "Function") {
          pushViolation(
            "new Function() is blocked in rule files.",
            "new Function("
          );
        }
        break;
      }
      case "ImportExpression": {
        const src = childNode(node.source);
        if (src && src.type !== "Literal") {
          pushViolation(
            "Dynamic import() with non-literal argument is blocked in rule files.",
            "import("
          );
        }
        break;
      }
      case "AssignmentExpression": {
        const left = childNode(node.left);
        if (left && left.type === "MemberExpression") {
          const leftObj = childNode(left.object);
          const leftProp = childNode(left.property);
          const leftObjName = leftObj ? strProp(leftObj, "name") : undefined;
          const leftPropName = leftProp ? strProp(leftProp, "name") : undefined;
          if (leftObjName === "globalThis") {
            pushViolation(
              "Mutating globalThis is blocked in rule files.",
              "globalThis."
            );
          }
          if (leftObjName === "process" && leftPropName === "env") {
            const target = `${leftObjName}.${leftPropName}`;
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
          const child = childNode(item);
          if (child) walk(child);
        }
      } else {
        const child = childNode(value);
        if (child) walk(child);
      }
    }
  }

  if (isAstNode(ast)) walk(ast);
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
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  let js: string;
  try {
    js = transpiler.transformSync(source);
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
        const obj = childNode(node.object);
        const prop = childNode(node.property);
        if (!obj || !prop) break;
        const computed = boolProp(node, "computed");
        const objName = strProp(obj, "name");
        const propName = strProp(prop, "name");

        // Block Bun.env
        if (objName === "Bun" && !computed && propName === "env") {
          pushViolation(
            "Bun.env access is blocked in imported rule files.",
            "Bun.env"
          );
        }

        // Block process env reads
        if (objName === "process" && !computed && propName === "env") {
          const target = `${objName}.${propName}`;
          pushViolation(
            `${target} access is blocked in imported rule files.`,
            target
          );
        }
        break;
      }
      case "CallExpression": {
        const callee = childNode(node.callee);
        const name = callee ? strProp(callee, "name") : undefined;
        if (name && IMPORTED_BLOCKED_GLOBALS.has(name)) {
          pushViolation(
            `${name}() is blocked in imported rule files.`,
            `${name}(`
          );
        }
        break;
      }
      case "NewExpression": {
        const callee = childNode(node.callee);
        const name = callee ? strProp(callee, "name") : undefined;
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
          const child = childNode(item);
          if (child) walkImported(child);
        }
      } else {
        const child = childNode(value);
        if (child) walkImported(child);
      }
    }
  }

  if (isAstNode(ast)) walkImported(ast);

  // Combine: standard scan + imported-only scan
  const standardViolations = scanRuleSource(source);
  const importedViolations = remapViolations(source, rawViolations);
  return [...standardViolations, ...importedViolations];
}
