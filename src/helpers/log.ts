import { styleText } from "node:util";

// ---------------------------------------------------------------------------
// Log levels
// ---------------------------------------------------------------------------

export type LogLevel = "error" | "warn" | "info" | "debug";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

/**
 * The active log level. Defaults to "info", meaning error/warn/info are shown
 * and debug is suppressed. Set via `setLogLevel()` from the global `--log-level`
 * option, or via the `DEBUG` environment variable (which forces "debug").
 */
let currentLevel: LogLevel = Bun.env.DEBUG ? "debug" : "info";

/**
 * Set the active log level. Called once from CLI initialization when
 * the `--log-level` global option is parsed.
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
  if (level === "debug") {
    Bun.env.DEBUG = "1";
  }
}

function isEnabled(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[currentLevel];
}

// ---------------------------------------------------------------------------
// Breadcrumb hook — allows Sentry to tap into log calls without circular deps
// ---------------------------------------------------------------------------

type BreadcrumbFn = (
  category: string,
  message: string,
  level: "debug" | "info" | "warning" | "error"
) => void;

let breadcrumbHook: BreadcrumbFn | null = null;

/**
 * Register a function that receives log events as Sentry breadcrumbs.
 * Called once from sentry.ts after Sentry is initialized.
 */
export function registerBreadcrumbHook(fn: BreadcrumbFn): void {
  breadcrumbHook = fn;
}

// ---------------------------------------------------------------------------
// Log functions
// ---------------------------------------------------------------------------

export function logDebug(...args: Parameters<typeof console.debug>) {
  if (isEnabled("debug") || Bun.env.DEBUG) {
    const header = styleText("bgWhite", "DEBUG:");
    console.warn(header, ...args);
    breadcrumbHook?.("log", args.map(String).join(" "), "debug");
  }
  if (Bun.env.TRACE) console.trace();
}

export function logInfo(...args: Parameters<typeof console.info>) {
  if (isEnabled("info")) {
    console.log(styleText("bold", "info:"), ...args);
  }
}

export function logError(...args: Parameters<typeof console.error>) {
  // Errors are always shown regardless of log level
  console.error(styleText(["red", "bold"], "error:"), ...args);
  breadcrumbHook?.("log", args.map(String).join(" "), "error");
}

export function logWarn(...args: Parameters<typeof console.warn>) {
  if (isEnabled("warn")) {
    console.warn(styleText(["yellow", "bold"], "warn:"), ...args);
    breadcrumbHook?.("log", args.map(String).join(" "), "warning");
  }
}
