// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

export type Severity = "error" | "warning" | "info";

export interface GrepMatch {
  file: string;
  line: number;
  column: number;
  content: string;
}

export interface ViolationDetail {
  ruleId: string;
  adrId: string;
  message: string;
  file?: string;
  line?: number;
  endLine?: number;
  endColumn?: number;
  fix?: string;
  severity: Severity;
}

// --- Report interface (side-effect based) ---

export interface RuleReport {
  violation(
    detail: Omit<ViolationDetail, "ruleId" | "adrId" | "severity">
  ): void;
  warning(detail: Omit<ViolationDetail, "ruleId" | "adrId" | "severity">): void;
  info(detail: Omit<ViolationDetail, "ruleId" | "adrId" | "severity">): void;
}

export interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  main?: string;
  module?: string;
  types?: string;
  bin?: string | Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  private?: boolean;
  license?: string;
  repository?: string | { type: string; url: string };
  engines?: Record<string, string>;
  files?: string[];
  workspaces?: string[] | { packages: string[] };
  catalog?: Record<string, string>;
  [key: string]: unknown;
}

// --- AST ---

/** Languages supported by `RuleContext.ast()`. */
export type AstLanguage = "typescript" | "javascript" | "python" | "ruby";

/**
 * A source comment, present on the tree's `comments` array when `ast()` is
 * called with `{ comments: true }`.
 *
 * @property type - `"line"` for `//` and `#` comments; `"block"` for a
 * C-style delimited comment and for a whole Ruby `=begin`/`=end` region.
 * Python has no block comments, so its tokens are always `"line"`.
 * @property value - Comment text with its delimiters removed. A Ruby block
 * token carries the inner content only: marker lines stripped, line endings
 * normalized to LF.
 * @property loc - Position in the ORIGINAL source, accurate even for
 * `"typescript"`, whose tree `loc` is transpiled-relative. Columns are
 * character offsets in every language, including Ruby, whose sexp node
 * positions are byte offsets.
 * @see AstOptions
 */
export interface CommentToken {
  type: "line" | "block";
  value: string;
  loc: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

/**
 * Options for `RuleContext.ast()`.
 *
 * @property rev - `"base"` parses the file as of the comparison base commit
 * (merge base of `--base` and HEAD) rather than the working tree, so a rule
 * can ask whether executable structure changed. Throws when no base resolves
 * or the file is absent there; pair with `fileAtBase()` to detect that first.
 * @property comments - Attaches a `comments` array of {@link CommentToken}s
 * to the returned tree, the structured basis for comment-governance rules.
 * Supported for every {@link AstLanguage}; for `"ruby"` the array rides on
 * the returned sexp array as a non-index property.
 * @example
 * Detect a change in executable structure while ignoring comment-only edits.
 * Comments drop out of both tree shapes but node positions do not, so compare
 * a location-free projection:
 * ```ts
 * const strip = (tree: unknown) =>
 *   JSON.stringify(tree, (key, value) =>
 *     ["loc", "range", "lineno", "col_offset"].includes(key) ? undefined : value
 *   );
 * const changed =
 *   strip(await ctx.ast(file, "typescript")) !==
 *   strip(await ctx.ast(file, "typescript", { rev: "base" }));
 * ```
 */
export interface AstOptions {
  rev?: "base";
  comments?: boolean;
}

/**
 * A node in the ESTree tree returned for `"typescript"`/`"javascript"`.
 * Only the fields common to every node are typed; the rest of each node's
 * grammar is reachable through the index signature — walk it against the
 * ESTree spec. For `"typescript"`, `loc` refers to the transpiled output
 * (see `ast()`), not the original `.ts` source.
 */
export interface EsTreeNode {
  type: string;
  loc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  } | null;
  range?: [number, number];
  [key: string]: unknown;
}

/** Root ESTree node returned for `"typescript"`/`"javascript"`. */
export interface EsTreeProgram extends EsTreeNode {
  type: "Program";
  sourceType: "module" | "script";
  body: EsTreeNode[];
  /** Present only when parsed with `{ comments: true }`. */
  comments?: CommentToken[];
}

/**
 * A node in the Python `ast` tree returned for `"python"`, serialized to JSON.
 * `_type` is the node class name (e.g. `"FunctionDef"`, `"Call"`,
 * `"ExceptHandler"`). Position attributes are present on most nodes. Field
 * values are other `PythonAstNode`s, arrays, or primitives, reachable through
 * the index signature — walk it against the standard `ast` module's grammar.
 */
export interface PythonAstNode {
  _type: string;
  lineno?: number;
  col_offset?: number;
  end_lineno?: number;
  end_col_offset?: number;
  [key: string]: unknown;
}

/** Root Python node returned for `"python"` (`_type: "Module"`). */
export interface PythonAstModule extends PythonAstNode {
  _type: "Module";
  body: PythonAstNode[];
  /** Present only when parsed with `{ comments: true }`. */
  comments?: CommentToken[];
}

/**
 * The Ruby AST returned for `"ruby"` — `Ripper.sexp` output as nested arrays.
 * Each node is `[nodeType, ...children]` where `nodeType` is a string tag
 * (e.g. `"program"`, `"command"`, `"@ident"`) and children are further
 * `RubyAstNode`s, `[line, column]` pairs, strings, or `null`. Ripper's shape
 * is deliberately not normalized — walk it against Ripper's own grammar.
 */
export type RubyAstNode = unknown[];

/**
 * Root Ruby value returned for `"ruby"` — the full `Ripper.sexp` output array
 * (`["program", …]`). When parsed with `{ comments: true }`, a `comments`
 * array of {@link CommentToken}s rides on the array as a non-index property;
 * it is absent otherwise.
 */
export interface RubyAstProgram extends Array<unknown> {
  /** Present only when parsed with `{ comments: true }`. */
  comments?: CommentToken[];
}

/**
 * Return type of the language-agnostic `ast()` overload (when `language` is a
 * non-literal `AstLanguage`). The shape is language-native and deliberately
 * NOT unified across languages (see ARCH-022); prefer calling `ast()` with a
 * string literal so the per-language overload narrows this union for you.
 */
export type AstNode = EsTreeProgram | PythonAstModule | RubyAstProgram;

// --- Rule Context ---

export interface RuleContext {
  projectRoot: string;
  scopedFiles: string[];
  changedFiles: string[];
  glob(pattern: string): Promise<string[]>;
  grep(file: string, pattern: RegExp): Promise<GrepMatch[]>;
  grepFiles(pattern: RegExp, fileGlob: string): Promise<GrepMatch[]>;
  readFile(path: string): Promise<string>;
  /**
   * Read a file's source at the comparison base revision (the merge base of
   * `--base` and HEAD).
   *
   * @param path - Project-relative path to read.
   * @returns The file's content at the base, or null for both
   * "nothing to compare against" cases — no base resolved (no `--base`, or
   * unrelated histories) and path absent at the base — so one null test
   * covers each. For a structural comparison prefer
   * `ast(path, language, { rev: "base" })`.
   */
  fileAtBase(path: string): Promise<string | null>;
  readJSON(path: "package.json"): Promise<PackageJson>;
  readJSON(path: string): Promise<unknown>;
  /**
   * Parse a source file into its language-native AST.
   *
   * @param path - Project-relative path to parse.
   * @param language - Selects both the parser and the return shape. Shapes are
   * language-native and NOT unified (ARCH-022) — walk each against its own
   * grammar.
   * @param opts - See {@link AstOptions} for `rev` and `comments`.
   * @returns An {@link EsTreeProgram} for `"typescript"`/`"javascript"`, a
   * {@link PythonAstModule} for `"python"`, or a {@link RubyAstProgram} for
   * `"ruby"`. TypeScript and JavaScript parse in-process; Python and Ruby
   * require their interpreter (`python3`/`python`, `ruby`) on PATH wherever
   * `archgate check` runs, locally and in CI.
   * @throws When the file fails to parse or the required interpreter is
   * missing — never returns null. The message distinguishes the two cases.
   * @see ARCH-022
   */
  ast(
    path: string,
    language: "typescript" | "javascript",
    opts?: AstOptions
  ): Promise<EsTreeProgram>;
  ast(
    path: string,
    language: "python",
    opts?: AstOptions
  ): Promise<PythonAstModule>;
  ast(
    path: string,
    language: "ruby",
    opts?: AstOptions
  ): Promise<RubyAstProgram>;
  ast(path: string, language: AstLanguage, opts?: AstOptions): Promise<AstNode>;
  /**
   * Collect every node in a parsed AST whose type-discriminant field matches
   * one of `types`. Pure synchronous traversal — no I/O.
   *
   * @param tree - Any parsed tree or subtree; `tree` itself is a match
   * candidate. Own-enumerable object values and arrays are traversed.
   * @param types - Discriminant values to match against `_type` (Python) or
   * `type` (ESTree TypeScript/JavaScript).
   * @returns Matching nodes in preorder, empty when nothing matches. Ruby
   * sexp nodes are plain arrays carrying no discriminant field, so only
   * embedded object nodes can match.
   */
  findAstNodes(tree: EsTreeNode, ...types: string[]): EsTreeNode[];
  findAstNodes(tree: PythonAstNode, ...types: string[]): PythonAstNode[];
  findAstNodes(
    tree: unknown,
    ...types: string[]
  ): (EsTreeNode | PythonAstNode)[];
  report: RuleReport;
}

export interface RuleConfig {
  description: string;
  severity?: Severity;
  check: (ctx: RuleContext) => Promise<void>;
}

export type RuleSet = { rules: Record<string, RuleConfig> };
