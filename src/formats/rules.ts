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

// --- Rule Context ---

export interface RuleContext {
  projectRoot: string;
  scopedFiles: string[];
  changedFiles: string[];
  glob(pattern: string): Promise<string[]>;
  grep(file: string, pattern: RegExp): Promise<GrepMatch[]>;
  grepFiles(pattern: RegExp, fileGlob: string): Promise<GrepMatch[]>;
  readFile(path: string): Promise<string>;
  readJSON(path: string): Promise<unknown>;
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
