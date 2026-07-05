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
 * Root node returned by `RuleContext.ast()`.
 *
 * The shape is language-native and deliberately NOT unified across languages
 * (see ARCH-022):
 * - `"typescript"` / `"javascript"` — ESTree Program (meriyah). TypeScript is
 *   transpiled before parsing, so type-only syntax is erased from the tree.
 * - `"python"` — the standard `ast` module tree serialized to JSON; each node
 *   is `{ _type: "Name", ...fields, lineno, col_offset, ... }`.
 * - `"ruby"` — `Ripper.sexp` output: nested arrays such as
 *   `["program", [["command", ...]]]` with `[line, column]` position pairs.
 */
export type AstNode = Record<string, unknown> | unknown[];

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
   * TypeScript/JavaScript parse in-process. Python and Ruby require the
   * corresponding interpreter (`python3`/`python`, `ruby`) on PATH wherever
   * `archgate check` runs — locally and in CI.
   *
   * Throws (never returns null) when the file fails to parse or the required
   * interpreter is missing; the error message distinguishes the two cases.
   * The returned node shape differs per language — see {@link AstNode}.
   */
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
