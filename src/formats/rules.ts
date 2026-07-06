// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
// --- Severity ---

export type Severity = "error" | "warning" | "info";

// --- Grep Match ---

export interface GrepMatch {
  file: string;
  line: number;
  column: number;
  content: string;
}

// --- Violation Detail ---

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

// --- Package JSON ---

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
 * A node in the ESTree tree returned for `"typescript"`/`"javascript"`.
 * `type` is the ESTree node discriminant (e.g. `"ImportDeclaration"`,
 * `"CallExpression"`). Only the fields common to every node are typed; the
 * rest of each node's grammar is reachable through the index signature — walk
 * it against the ESTree spec. Note: for `"typescript"`, `loc` refers to the
 * transpiled output (see `ast()`), not the original `.ts` source.
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
 * Return type of the language-agnostic `ast()` overload (when `language` is a
 * non-literal `AstLanguage`). The shape is language-native and deliberately
 * NOT unified across languages (see ARCH-022); prefer calling `ast()` with a
 * string literal so the per-language overload narrows this union for you.
 */
export type AstNode = EsTreeProgram | PythonAstModule | RubyAstNode;

// --- Rule Context ---

export interface RuleContext {
  projectRoot: string;
  scopedFiles: string[];
  changedFiles: string[];
  glob(pattern: string): Promise<string[]>;
  grep(file: string, pattern: RegExp): Promise<GrepMatch[]>;
  grepFiles(pattern: RegExp, fileGlob: string): Promise<GrepMatch[]>;
  readFile(path: string): Promise<string>;
  readJSON(path: "package.json"): Promise<PackageJson>;
  readJSON(path: string): Promise<unknown>;
  /**
   * Parse a source file into its language-native AST.
   *
   * The return type is selected by the `language` literal: an
   * {@link EsTreeProgram} for `"typescript"`/`"javascript"`, a
   * {@link PythonAstModule} for `"python"`, and a {@link RubyAstNode} for
   * `"ruby"`. The shapes are language-native and are NOT unified (see
   * ARCH-022) — walk each against its own grammar.
   *
   * TypeScript/JavaScript parse in-process. Python and Ruby require the
   * corresponding interpreter (`python3`/`python`, `ruby`) on PATH wherever
   * `archgate check` runs — locally and in CI.
   *
   * Throws (never returns null) when the file fails to parse or the required
   * interpreter is missing; the error message distinguishes the two cases.
   */
  ast(
    path: string,
    language: "typescript" | "javascript"
  ): Promise<EsTreeProgram>;
  ast(path: string, language: "python"): Promise<PythonAstModule>;
  ast(path: string, language: "ruby"): Promise<RubyAstNode>;
  ast(path: string, language: AstLanguage): Promise<AstNode>;
  report: RuleReport;
}

// --- Rule Config ---

export interface RuleConfig {
  description: string;
  severity?: Severity;
  check: (ctx: RuleContext) => Promise<void>;
}

// --- Rule Set ---

export type RuleSet = { rules: Record<string, RuleConfig> };
