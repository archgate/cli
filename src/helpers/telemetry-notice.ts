/**
 * telemetry-notice.ts — One-time notice about telemetry on first CLI run.
 *
 * Shows a brief message to stderr (not stdout, per ARCH-003) informing users
 * that anonymous data is collected and how to opt out. The notice is shown
 * once, then a marker file is written to prevent repeat notices.
 */

import { existsSync } from "node:fs";

import { logDebug, logWarn } from "./log";
import { internalPath, createPathIfNotExists } from "./paths";
import { isTelemetryEnabled } from "./telemetry-config";

const NOTICE_MARKER = "telemetry-notice-shown";

function markerPath(): string {
  return internalPath(NOTICE_MARKER);
}

/**
 * Show a one-time telemetry notice on first run.
 * Only shown if telemetry is enabled and the notice hasn't been shown before.
 * Writes to stderr via logWarn() to avoid interfering with --json output (ARCH-003).
 */
export function showTelemetryNotice(): void {
  if (!isTelemetryEnabled()) return;
  if (existsSync(markerPath())) return;

  // Show notice to stderr via logWarn (diagnostics channel per ARCH-002/ARCH-003)
  logWarn("Archgate collects anonymous usage data to improve the CLI.");
  logWarn("Disable: `archgate telemetry disable` or set ARCHGATE_TELEMETRY=0");
  logWarn("Learn more: https://cli.archgate.dev/reference/telemetry");

  // Write marker asynchronously — don't block CLI startup
  createPathIfNotExists(internalPath());
  Bun.write(markerPath(), new Date().toISOString()).catch(() => {
    logDebug("Failed to write telemetry notice marker (ignored)");
  });
}
