/**
 * sentry.ts — Error tracking via @sentry/bun SDK.
 *
 * Uses the official Sentry SDK for Bun to capture errors with full
 * breadcrumb context. Breadcrumbs are added throughout CLI execution
 * (command start, config loading, rule checks, etc.) so that crash
 * reports include the sequence of operations leading to the failure.
 *
 * IP anonymization: the Sentry project has "Prevent Storing of IP Addresses"
 * enabled server-side.
 *
 * Sentry is only initialized when telemetry is enabled. All Sentry calls
 * are wrapped to never affect CLI behavior or exit codes.
 */

import { join } from "node:path";

import * as Sentry from "@sentry/bun";

import { logDebug } from "./log";
import { internalPath } from "./paths";
import { getPlatformInfo } from "./platform";
import { getInstallId, isTelemetryEnabled } from "./telemetry-config";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Sentry DSN (write-only ingest URL, safe to embed in client code).
 */
const SENTRY_DSN =
  "https://bb693c2cbc4238dbcd6efac609062402@o4511085517340672.ingest.de.sentry.io/4511085521469520";

// ---------------------------------------------------------------------------
// Install method detection
// ---------------------------------------------------------------------------

function detectInstallMethod(): string {
  const execPath = process.execPath;
  const binDir = internalPath("bin");

  if (execPath.startsWith(binDir)) return "binary";

  const home = process.env.HOME ?? process.env.USERPROFILE ?? "~";
  const protoHome = process.env.PROTO_HOME ?? join(home, ".proto");
  const protoToolDir = join(protoHome, "tools", "archgate");
  if (execPath.startsWith(protoToolDir)) return "proto";

  if (execPath.includes("node_modules")) return "local";

  return "package-manager";
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let initialized = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function getCliVersion(): string {
  try {
    const pkg = require("../../package.json") as { version: string };
    return pkg.version;
  } catch {
    return "unknown";
  }
}

/**
 * Initialize Sentry error tracking. Call once at CLI startup.
 * No-op if telemetry is disabled.
 */
export function initSentry(): void {
  if (!isTelemetryEnabled()) {
    logDebug("Sentry disabled — telemetry is off");
    return;
  }

  const cliVersion = getCliVersion();
  const { runtime } = getPlatformInfo();

  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      release: cliVersion,
      environment: process.env.NODE_ENV ?? "production",
      // Do not send default PII (hostnames, IPs, etc.)
      sendDefaultPii: false,
      // Enable tracing so sentry-trace headers propagate to the plugins service
      tracesSampleRate: 1.0,
      // Propagate traces to the plugins API for distributed tracing
      tracePropagationTargets: ["plugins.archgate.dev"],
      // Set the anonymous install ID as the user
      initialScope: {
        user: { id: getInstallId() },
        tags: {
          cli_version: cliVersion,
          os: runtime,
          arch: process.arch,
          is_ci: String(Boolean(process.env.CI)),
          is_tty: String(Boolean(process.stdout.isTTY)),
          install_method: detectInstallMethod(),
          install_path: process.execPath,
        },
        contexts: {
          runtime: {
            name: "bun",
            // oxlint-disable-next-line no-negated-condition -- Bun availability check requires typeof guard
            version: typeof Bun !== "undefined" ? Bun.version : "unknown",
          },
        },
      },
      // Keep default integrations including Http/Undici for distributed tracing
      // (sentry-trace headers are auto-injected into fetch calls matching
      // tracePropagationTargets above)
      // Limit breadcrumbs to keep payloads small
      maxBreadcrumbs: 50,
    });

    initialized = true;
    logDebug("Sentry initialized");
  } catch {
    logDebug("Sentry init failed (silently ignored)");
  }
}

/**
 * Add a breadcrumb to the current Sentry scope.
 * Breadcrumbs are attached to the next error event, providing context
 * about the sequence of operations leading to a crash.
 *
 * @param category Short category name (e.g., "command", "config", "check")
 * @param message Human-readable description
 * @param data Optional structured data
 * @param level Breadcrumb severity level (default: "info")
 */
export function addBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
  level: "debug" | "info" | "warning" | "error" = "info"
): void {
  if (!initialized) return;

  try {
    Sentry.addBreadcrumb({
      category,
      message,
      data,
      level,
      timestamp: Date.now() / 1000,
    });
  } catch {
    // Never let breadcrumb failures affect CLI behavior
  }
}

/**
 * Capture an exception and send it to Sentry.
 *
 * @param error The error to capture
 * @param context Optional extra context (command name, options, etc.)
 */
export function captureException(
  error: unknown,
  context?: Record<string, unknown>
): void {
  if (!initialized) return;

  try {
    Sentry.captureException(error, { contexts: { cli: context } });
  } catch {
    logDebug("Sentry capture failed (silently ignored)");
  }
}

/**
 * Flush pending Sentry events. Call before process exit to ensure
 * error events are sent.
 *
 * @param timeoutMs Maximum time to wait for flush (default: 2000ms)
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!initialized) return;

  try {
    await Sentry.flush(timeoutMs);
    logDebug("Sentry flushed");
  } catch {
    logDebug("Sentry flush failed (silently ignored)");
  }
}

// ---------------------------------------------------------------------------
// Testing helpers
// ---------------------------------------------------------------------------

/** Reset Sentry state. For testing only. */
export function _resetSentry(): void {
  if (initialized) {
    Sentry.close();
  }
  initialized = false;
}
