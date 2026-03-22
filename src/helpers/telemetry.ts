/**
 * telemetry.ts — Anonymous usage analytics via PostHog Node SDK.
 *
 * Uses the official posthog-node SDK for event capture with automatic
 * batching and flush. Events are captured during command execution and
 * flushed before process exit.
 *
 * IP anonymization: the CLI sends `$ip: null` on every event to signal
 * PostHog to resolve geo server-side then discard the IP. The project
 * also has "Discard client IP data" enabled in PostHog settings.
 *
 * See https://cli.archgate.dev/reference/telemetry for the full privacy policy.
 */

import { PostHog } from "posthog-node";

import packageJson from "../../package.json";
import { logDebug } from "./log";
import { getPlatformInfo } from "./platform";
import { getInstallId, isTelemetryEnabled } from "./telemetry-config";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * PostHog project API key (write-only, safe to embed in client code).
 * This key can only ingest events — it cannot read data or manage the project.
 */
const POSTHOG_API_KEY = "phc_gSnjpsvRfQggmgeXUgbevbG0SULK5rT9gTZ8m3yjknv";
const POSTHOG_HOST = "https://eu.i.posthog.com";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let client: PostHog | null = null;
let initialized = false;
let distinctId = "";

// ---------------------------------------------------------------------------
// Shared properties (computed once per process)
// ---------------------------------------------------------------------------

function getCommonProperties(): Record<string, unknown> {
  const { runtime } = getPlatformInfo();
  return {
    cli_version: packageJson.version,
    os: runtime,
    arch: process.arch,
    bun_version: Bun.version,
    is_ci: Boolean(Bun.env.CI),
    is_tty: Boolean(process.stdout.isTTY),
    // Signal PostHog to resolve geo then discard the IP
    $ip: null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize telemetry. Call once at CLI startup.
 * If telemetry is disabled, this is a no-op and all subsequent calls are too.
 */
export function initTelemetry(): void {
  if (!isTelemetryEnabled()) {
    logDebug("Telemetry disabled — skipping init");
    return;
  }

  distinctId = getInstallId();

  try {
    client = new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      // Disable polling for feature flags — we don't use them in the CLI
      disableGeoip: false,
      flushAt: 20,
      flushInterval: 10_000,
    });

    initialized = true;
    logDebug("Telemetry initialized:", distinctId);
  } catch {
    logDebug("Telemetry init failed (silently ignored)");
  }
}

/**
 * Track a named event with optional properties.
 * No-op if telemetry is disabled.
 */
export function trackEvent(
  event: string,
  properties?: Record<string, unknown>
): void {
  if (!initialized || !client) return;

  try {
    client.capture({
      distinctId,
      event,
      properties: { ...getCommonProperties(), ...properties },
    });
    logDebug("Telemetry event captured:", event);
  } catch {
    // Silently ignore — telemetry must never affect CLI behavior
  }
}

/**
 * Track a CLI command invocation.
 */
export function trackCommand(
  command: string,
  options?: Record<string, unknown>
): void {
  trackEvent("command_executed", { command, ...options });
}

/**
 * Track command completion with exit code and duration.
 */
export function trackCommandResult(
  command: string,
  exitCode: number,
  durationMs: number
): void {
  trackEvent("command_completed", {
    command,
    exit_code: exitCode,
    duration_ms: durationMs,
  });
}

/**
 * Flush pending events to PostHog. Call before process exit to ensure
 * events are delivered.
 */
export async function flushTelemetry(timeoutMs = 3000): Promise<void> {
  if (!initialized || !client) return;

  try {
    logDebug("Flushing telemetry events");
    // Race shutdown against a timeout to prevent hanging on exit
    await Promise.race([
      client.shutdown(),
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      }),
    ]);
    logDebug("Telemetry flushed");
  } catch {
    // Silently ignore — telemetry must never affect CLI behavior
    logDebug("Telemetry flush failed (silently ignored)");
  }
}

// ---------------------------------------------------------------------------
// Testing helpers
// ---------------------------------------------------------------------------

/** Reset telemetry state. For testing only. */
export function _resetTelemetry(): void {
  if (client) {
    client.shutdown().catch(() => {});
  }
  client = null;
  initialized = false;
  distinctId = "";
}

/** Get the PostHog client instance. For testing only. */
export function _getClient(): PostHog | null {
  return client;
}
