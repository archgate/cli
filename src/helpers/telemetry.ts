/**
 * telemetry.ts — Anonymous usage analytics via PostHog HTTP API.
 *
 * No SDK dependency — uses fetch() directly to POST events to PostHog's
 * capture endpoint. Events are buffered during command execution and flushed
 * once at the end. All network calls are fire-and-forget: failures are
 * silently ignored and never affect CLI behavior or exit codes.
 *
 * IP anonymization: PostHog resolves IP to country/region server-side, then
 * the "Discard client IP data" project setting drops the IP from storage.
 * The CLI sends `$ip: null` to explicitly signal PostHog not to store it.
 *
 * See https://cli.archgate.dev/reference/telemetry for the full privacy policy.
 */

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
const POSTHOG_API_KEY = "phc_placeholder";
const POSTHOG_HOST = "https://us.i.posthog.com";
const CAPTURE_ENDPOINT = `${POSTHOG_HOST}/capture/`;

/** Maximum time to wait for the flush request (ms). */
const FLUSH_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PostHogEvent {
  event: string;
  properties: Record<string, unknown>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let eventBuffer: PostHogEvent[] = [];
let initialized = false;
let distinctId = "";

// ---------------------------------------------------------------------------
// Shared properties (computed once per process)
// ---------------------------------------------------------------------------

function getCommonProperties(): Record<string, unknown> {
  const { runtime } = getPlatformInfo();
  return {
    $lib: "archgate-cli",
    cli_version: packageJson.version,
    os: runtime,
    arch: process.arch,
    bun_version: Bun.version,
    is_ci: Boolean(Bun.env.CI),
    is_tty: Boolean(process.stdout.isTTY),
    node_env: Bun.env.NODE_ENV ?? "production",
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
  initialized = true;
  logDebug("Telemetry initialized:", distinctId);
}

/**
 * Track a named event with optional properties.
 * Events are buffered and sent on flush(). No-op if telemetry is disabled.
 */
export function trackEvent(
  event: string,
  properties?: Record<string, unknown>
): void {
  if (!initialized) return;

  eventBuffer.push({
    event,
    properties: {
      ...getCommonProperties(),
      ...properties,
      distinct_id: distinctId,
    },
    timestamp: new Date().toISOString(),
  });

  logDebug("Telemetry event buffered:", event);
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
 * Flush all buffered events to PostHog.
 * Fire-and-forget: errors are silently swallowed.
 * Returns a promise that resolves when the flush attempt completes.
 */
export async function flushTelemetry(): Promise<void> {
  if (!initialized || eventBuffer.length === 0) return;

  const events = eventBuffer;
  eventBuffer = [];

  try {
    logDebug(`Flushing ${events.length} telemetry event(s)`);

    await fetch(CAPTURE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: POSTHOG_API_KEY, batch: events }),
      signal: AbortSignal.timeout(FLUSH_TIMEOUT_MS),
    });
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
  eventBuffer = [];
  initialized = false;
  distinctId = "";
}

/** Get buffered events. For testing only. */
export function _getEventBuffer(): PostHogEvent[] {
  return eventBuffer;
}
