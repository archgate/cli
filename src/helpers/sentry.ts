/**
 * sentry.ts — Error tracking via @sentry/node-core light mode.
 *
 * Uses Sentry's lightweight "light" SDK variant which excludes all
 * OpenTelemetry auto-instrumentation — ideal for a CLI that only needs
 * error capture with breadcrumbs. This avoids pulling in 600+ modules
 * of OTel instrumentation for MongoDB, Redis, Express, etc.
 *
 * IP anonymization: the Sentry project has "Prevent Storing of IP Addresses"
 * enabled server-side.
 *
 * Sentry is only initialized when telemetry is enabled. All Sentry calls
 * are wrapped to never affect CLI behavior or exit codes.
 */

import * as Sentry from "@sentry/node-core/light";

import packageJson from "../../package.json";
import { detectInstallMethod } from "./install-info";
import { logDebug } from "./log";
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

/**
 * The path to the archgate executable or script.
 * - Compiled binary: process.execPath IS the archgate binary
 * - bun run / bunx: Bun.main is the entry script (src/cli.ts or similar)
 */
function getArchgatePath(): string {
  const execPath = process.execPath;
  if (!execPath.includes("bun")) return execPath;
  return Bun.main;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let initialized = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize Sentry error tracking. Call once at CLI startup.
 * No-op if telemetry is disabled.
 */
export function initSentry(): void {
  if (!isTelemetryEnabled()) {
    logDebug("Sentry disabled — telemetry is off");
    return;
  }

  const cliVersion = packageJson.version;
  const { runtime } = getPlatformInfo();

  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      release: cliVersion,
      environment: Bun.env.NODE_ENV ?? "production",
      // Disable sending events in test environments
      enabled: Bun.env.NODE_ENV !== "test",
      // Do not send default PII (hostnames, IPs, etc.)
      sendDefaultPii: false,
      // Drop user-initiated prompt cancellations (Ctrl+C)
      beforeSend(event) {
        const values = event.exception?.values;
        if (
          values?.some(
            (v) =>
              v.type === "ExitPromptError" ||
              v.value?.includes("force closed the prompt with SIGINT")
          )
        ) {
          return null;
        }
        return event;
      },
      // Set the anonymous install ID as the user
      initialScope: {
        user: { id: getInstallId() },
        tags: {
          cli_version: cliVersion,
          os: runtime,
          arch: process.arch,
          is_ci: String(Boolean(Bun.env.CI)),
          is_tty: String(Boolean(process.stdout.isTTY)),
          install_method: detectInstallMethod(),
          install_path: getArchgatePath(),
        },
        contexts: {
          // Override the default "node" runtime that @sentry/node-core sets
          runtime: { name: "bun", version: Bun.version },
        },
      },
      // Override the default nodeContextIntegration which reports runtime as "node"
      integrations: (defaults) =>
        defaults.filter((i) => i.name !== "NodeContext"),
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
