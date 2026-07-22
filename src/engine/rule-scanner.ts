// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { readFileSync, realpathSync } from "node:fs";
import { dirname, relative } from "node:path";

import { z } from "zod";

import { parseJsModule, type MeriyahProgram } from "./js-parser";
import {
  isRelativeSpecifier,
  resolveContainedImport,
} from "./rule-import-resolver";

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

/**
 * Live globals in the rule runtime whose mere *naming* is blocked — in any
 * position, code only (a same-named property key or string is fine).
 *
 * This is the module allowlist's logic (above) applied to globals. A rule file
 * runs in-process, so `Bun`, `process`, and the global object are live and
 * expose subprocess/filesystem/network/native capabilities directly — no import
 * needed. Blocking specific *shapes* of reaching them (`Bun.spawn`, `Bun[x]`)
 * is the same losing game as a module denylist: `const B = Bun; B.spawn(...)`,
 * `const { spawn } = Bun`, `Reflect.get(Bun, "spawn")`, and `global.Bun.spawn`
 * all reach the identical capability without matching any of those shapes.
 * Enumerating the evasions is unwinnable; refusing to let rule code *name* the
 * capability source is not. Rules touch the project only through `ctx`.
 *
 * Grouped by what each reaches:
 * - the global object and its aliases, and reflection over it;
 * - dynamic code execution (`eval`, and `Function` — the `Function` constructor
 *   is `eval`), which also subsumes the `.constructor` chain blocked below;
 * - network;
 * - module loading (`require`; `import.meta.require` is handled separately as it
 *   is a MetaProperty member, not a bare identifier).
 */
const BANNED_GLOBALS = new Set([
  "globalThis",
  "global",
  "self",
  "Bun",
  "process",
  "Reflect",
  "eval",
  "Function",
  "fetch",
  "WebSocket",
  "XMLHttpRequest",
  "EventSource",
  "require",
]);

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
  source?: AstNode | null;
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
    // ESTree sets `source: null` on an `export` declaration that has no `from`
    // clause (`export function`, `export const`, `export { local }`). Without
    // `.nullable()` the whole node fails validation and `parseNode` drops it —
    // silently skipping every child, so anything dangerous inside a top-level
    // `export`-declaration would go unscanned. Tolerating null keeps the node
    // in the walk; `checkModuleSpecifier` still correctly no-ops on a null src.
    source: z
      .lazy(() => AstNodeSchema)
      .nullable()
      .optional(),
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

/**
 * Options for {@link scanRuleSource}. Every field is optional and absent ⇒
 * the historical behavior (all relative imports blocked, no pre-transpile).
 */
export interface ScanRuleOptions {
  /** Pre-transpiled JS, to skip the internal TypeScript transpile step. */
  preTranspiled?: string;
  /**
   * Absolute path of the file being scanned. Required to resolve relative
   * imports; without it every relative import is blocked.
   */
  filePath?: string;
  /**
   * Absolute, realpath'd directories — guaranteed by the caller to live inside
   * `.archgate/` (see `resolveRuleImportDirs`) — that a relative import may
   * resolve into. Empty (the default) blocks every relative import.
   */
  allowedImportDirs?: string[];
}

export function scanRuleSource(
  source: string,
  opts: ScanRuleOptions = {},
  // Internal: canonical paths already scanned on this transitive walk, so an
  // import cycle terminates. Not part of the public contract.
  visited: Set<string> = new Set()
): ScanViolation[] {
  const { preTranspiled, filePath, allowedImportDirs = [] } = opts;
  // Relative imports found to be allowed (resolved, contained real paths).
  // Scanned transitively after the walk with the SAME options.
  const resolvedImports = new Set<string>();

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
   * The statically-knowable property name of a member expression — from
   * `o.name` and from `o["name"]` alike. `o[k]` with a computed, non-literal
   * key returns undefined (unknowable to a scanner that does not track values;
   * see ARCH-024 on the limits of the static boundary).
   */
  function staticPropName(
    prop: AstNode,
    computed: boolean
  ): string | undefined {
    if (!computed) return prop.name;
    return typeof prop.value === "string" ? prop.value : undefined;
  }

  /**
   * Flag a code reference to a banned global (`checkBannedIdentifier`), skipping
   * property-key positions — `foo.process` and `{ process: 1 }` name a property,
   * not the global. Called from the recursion, which knows the parent context.
   */
  function checkBannedIdentifier(node: AstNode, isPropertyKey: boolean): void {
    if (
      node.type !== "Identifier" ||
      typeof node.name !== "string" ||
      !BANNED_GLOBALS.has(node.name)
    ) {
      return;
    }
    // Advance the occurrence counter for EVERY code-position occurrence of the
    // name — property-key slots included — so it stays aligned with the position
    // remapper, which counts all code occurrences (it skips only strings and
    // comments, not property keys). A property key (`{ Bun: 1 }`, `foo.Bun`)
    // names a property, not the global, so it is counted but never emitted;
    // skipping the count here would make a later *real* reference remap onto the
    // earlier key. Bypasses `pushViolation` because it must count-without-emit.
    const count = seenCounts.get(node.name) ?? 0;
    seenCounts.set(node.name, count + 1);
    if (!isPropertyKey) {
      rawViolations.push({
        message: `Reference to the "${node.name}" global is blocked in rule files. Rules reach the project only through the RuleContext API (ctx); naming a runtime global — even to alias, destructure, or reflect over it — is not permitted.`,
        searchText: node.name,
        occurrence: count,
      });
    }
  }

  /**
   * Opt-in escape valve for the module allowlist: a RELATIVE specifier is
   * accepted only when the project configured `ruleImports.allowedDirs` and the
   * specifier resolves (after realpath) to a file inside one of those dirs —
   * which are themselves proven to be inside `.archgate/`. The resolved path is
   * recorded for the transitive scan. Returns false (⇒ caller emits the normal
   * violation) when the feature is off, the specifier is not relative, or the
   * target is missing / escapes containment. Absent `filePath` or empty
   * `allowedImportDirs` ⇒ always false, i.e. the historical behavior.
   */
  function tryAllowRelativeImport(spec: string): boolean {
    if (filePath === undefined || allowedImportDirs.length === 0) return false;
    if (!isRelativeSpecifier(spec)) return false;
    const real = resolveContainedImport(spec, filePath, allowedImportDirs);
    if (real === null) return false;
    resolvedImports.add(real);
    return true;
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
    if (tryAllowRelativeImport(src)) return;
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
      case "ObjectPattern": {
        // Destructuring `const { constructor: F } = obj` READS `obj.constructor`
        // — the Function constructor (= eval), the same reach as `.constructor`
        // member access, but through a binding pattern the MemberExpression case
        // never sees. An object *literal* `{ constructor: 1 }` (ObjectExpression)
        // only names a property and is fine; only the pattern form performs the
        // read. `staticPropName` covers `{ constructor: F }`, `{ ["constructor"]:
        // F }`, and the shorthand `{ constructor }`. A runtime-computed key
        // (`{ [c]: F }`) is the same documented static-analysis residual as the
        // computed-variable member case (see ARCH-024).
        const props = Array.isArray(node.properties) ? node.properties : [];
        for (const raw of props) {
          const p = parseNode(raw);
          if (!p || p.type !== "Property") continue;
          const key = parseNode(p.key);
          if (
            key &&
            staticPropName(key, p.computed ?? false) === "constructor"
          ) {
            pushViolation(
              "Destructuring `.constructor` is blocked in rule files — it reaches the Function constructor, which is equivalent to eval.",
              "constructor"
            );
          }
        }
        break;
      }
      case "MemberExpression": {
        const obj = node.object;
        const prop = node.property;
        if (!obj || !prop) break;
        const computed = node.computed ?? false;

        // Block `.constructor` (dotted or computed-literal), on ANY receiver.
        // `(() => {}).constructor` is the `Function` constructor — i.e. eval —
        // so `f = (() => {}).constructor; f("return import('node:fs')")()`
        // would run arbitrary, unscanned code, bypassing every other check
        // including the module allowlist. Naming `Function`/`eval` directly is
        // already blocked as a global; this closes the property-chain route.
        if (staticPropName(prop, computed) === "constructor") {
          pushViolation(
            "Access to `.constructor` is blocked in rule files — it reaches the Function constructor, which is equivalent to eval.",
            computed ? `["constructor"]` : ".constructor"
          );
        }

        // Block `import.meta.require(...)` — a require() escape that names no
        // banned module and is a MetaProperty member, not a bare identifier
        // (so the banned-globals check does not see it). `staticPropName` covers
        // both `.require` and `["require"]`; the latter also reaches here via
        // the transpiler, which rewrites the bracket form to dotted.
        if (
          obj.type === "MetaProperty" &&
          staticPropName(prop, computed) === "require"
        ) {
          // Anchor on `import.meta` — common to `.require` and `["require"]`.
          // Anchoring on the dotted spelling would miss (remap to line 0) when
          // the original source used brackets, since the remapper searches the
          // untransformed source, not the normalised AST.
          pushViolation(
            "import.meta.require() is blocked in rule files. Use the RuleContext API instead.",
            "import.meta"
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
          if (tryAllowRelativeImport(src)) break;
          // Anchor on `import(`, not the specifier: the literal is non-code to
          // the remapper, and `import(` survives arbitrary argument formatting.
          pushViolation(
            `Dynamic import of "${src}" is blocked in rule files. Only ${ALLOWED_MODULES_TEXT} may be imported; use the RuleContext API for filesystem, subprocess, and network access.`,
            "import("
          );
        }
        break;
      }
    }

    // Recurse into child nodes, checking each for a banned-global reference as
    // we descend. The parent knows whether a child sits in a property-key slot
    // (`foo.process`, `{ process: 1 }`) — a name there, not the global — so the
    // check is done here rather than in a per-node case. Assignments that mutate
    // a global (e.g. its `env`) are caught by this same reference check.
    for (const [key, value] of Object.entries(node)) {
      const isPropertyKey =
        (node.type === "MemberExpression" &&
          key === "property" &&
          !(node.computed ?? false)) ||
        (node.type === "Property" &&
          key === "key" &&
          !(node.computed ?? false));
      if (Array.isArray(value)) {
        for (const item of value) {
          const child = parseNode(item);
          if (child) {
            checkBannedIdentifier(child, false);
            walk(child);
          }
        }
      } else {
        const child = parseNode(value);
        if (child) {
          checkBannedIdentifier(child, isPropertyKey);
          walk(child);
        }
      }
    }
  }

  const root = parseNode(ast);
  if (root) walk(root);
  // Text-pass violations already carry true positions — they are found in the
  // original source, so they need no remapping back through the transpiler.
  const violations = textViolations.concat(
    remapViolations(source, rawViolations)
  );

  // Transitive scan: recurse into every allowed relative import with the SAME
  // options, so a contained helper cannot become an escape hatch (importing
  // `node:child_process`, calling `fetch`/`eval`, hiding an invisible char,
  // etc.). Cycles terminate via the shared `visited` set. This runs only when
  // the feature resolved at least one import; the default path is untouched.
  if (filePath !== undefined && resolvedImports.size > 0) {
    let selfReal = filePath;
    try {
      selfReal = realpathSync(filePath);
    } catch {
      // Non-canonicalizable self path — fall back to the given path; the
      // per-target `visited` guard below still bounds the recursion.
    }
    visited.add(selfReal);
    const fromDir = dirname(selfReal);
    for (const childPath of resolvedImports) {
      if (visited.has(childPath)) continue;
      visited.add(childPath);
      const rel = relative(fromDir, childPath);
      let childSource: string;
      try {
        childSource = readFileSync(childPath, "utf8");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        violations.push({
          message: `Imported file "${rel}" could not be read: ${msg}`,
          line: 1,
          column: 0,
          endLine: 1,
          endColumn: 0,
        });
        continue;
      }
      const childViolations = scanRuleSource(
        childSource,
        { filePath: childPath, allowedImportDirs },
        visited
      );
      for (const v of childViolations) {
        violations.push({
          ...v,
          message: `Imported file "${rel}": ${v.message}`,
        });
      }
    }
  }

  return violations;
}

/**
 * Scan an imported (untrusted) `.rules.ts` source.
 *
 * Historically this added stricter checks than `scanRuleSource()` — imported
 * rules were forbidden the environment reads (via `Bun` and `process`),
 * `require()`, and `WebSocket` that first-party rules were allowed. Those are
 * all now blocked for *every* rule file: naming `Bun`, `process`, `require`, or
 * `WebSocket`
 * (or any other runtime global) is refused by the banned-globals check in
 * `scanRuleSource()`. First-party and imported scans have therefore converged,
 * and this delegates. It remains a distinct export so the `adr import` call
 * site reads intentionally, and so the two can diverge again if a future
 * imported-only restriction is ever needed.
 *
 * Note: no `ScanRuleOptions` are forwarded, so the opt-in contained-relative-
 * import feature never applies to imported packs — they must stay
 * self-contained. Relative imports would in any case be meaningless for a pack
 * scanned before it is placed into a project's `.archgate/` tree.
 */
export function scanImportedRuleSource(source: string): ScanViolation[] {
  return scanRuleSource(source);
}
