/**
 * sentry.ts — Error tracking via Sentry HTTP envelope API.
 *
 * No SDK dependency — uses fetch() to POST error envelopes directly to
 * Sentry's envelope endpoint. This keeps the binary lean (ARCH-006) while
 * providing crash reporting for exit-code-2 errors.
 *
 * IP anonymization: the Sentry project has "Prevent Storing of IP Addresses"
 * enabled server-side. The CLI also omits user.ip_address from the payload.
 *
 * All network calls are fire-and-forget: failures never affect CLI behavior.
 */

import { logDebug } from "./log";
import { getPlatformInfo } from "./platform";
import { getInstallId, isTelemetryEnabled } from "./telemetry-config";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Sentry DSN (write-only ingest URL, safe to embed in client code).
 * Format: https://<key>@<host>/<project_id>
 */
const SENTRY_DSN =
  "https://bb693c2cbc4238dbcd6efac609062402@o4511085517340672.ingest.de.sentry.io/4511085521469520";

/** Maximum time to wait for the Sentry request (ms). */
const SENTRY_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// DSN parsing
// ---------------------------------------------------------------------------

interface ParsedDSN {
  publicKey: string;
  host: string;
  projectId: string;
}

function parseDSN(dsn: string): ParsedDSN | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.replace("/", "");
    const host = `${url.protocol}//${url.host}`;
    if (!publicKey || !projectId) return null;
    return { publicKey, host, projectId };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let initialized = false;
let parsedDSN: ParsedDSN | null = null;

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

  parsedDSN = parseDSN(SENTRY_DSN);
  if (!parsedDSN) {
    logDebug("Sentry disabled — invalid DSN");
    return;
  }

  initialized = true;
  logDebug("Sentry initialized");
}

/**
 * Capture an exception and send it to Sentry.
 * Fire-and-forget: errors are silently swallowed.
 *
 * @param error The error to capture
 * @param context Optional extra context (command name, options, etc.)
 */
export function captureException(
  error: unknown,
  context?: Record<string, unknown>
): void {
  if (!initialized || !parsedDSN) return;

  const err = error instanceof Error ? error : new Error(String(error));

  // Build and send envelope asynchronously — never block the CLI
  sendErrorEnvelope(err, context).catch(() => {
    logDebug("Sentry capture failed (silently ignored)");
  });
}

// ---------------------------------------------------------------------------
// Envelope construction
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
 * Build and send a Sentry error envelope via the HTTP API.
 *
 * Envelope format: https://develop.sentry.dev/sdk/envelopes/
 * Each line is a JSON object, separated by newlines:
 *   1. Envelope header (event_id, dsn, sent_at)
 *   2. Item header (type, content_type, length)
 *   3. Item payload (the error event)
 */
async function sendErrorEnvelope(
  error: Error,
  context?: Record<string, unknown>
): Promise<void> {
  if (!parsedDSN) return;

  const eventId = generateEventId();
  const cliVersion = getCliVersion();
  const installId = getInstallId();
  const { runtime } = getPlatformInfo();

  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: "error",
    release: `archgate@${cliVersion}`,
    environment: process.env.NODE_ENV ?? "production",
    server_name: undefined, // explicitly omit hostname
    user: {
      id: installId,
      // No ip_address — server-side stripping handles this
    },
    contexts: {
      runtime: {
        name: "bun",
        // oxlint-disable-next-line no-negated-condition -- Bun availability check requires typeof guard
        version: typeof Bun !== "undefined" ? Bun.version : "unknown",
      },
      os: { name: runtime, machine: process.arch },
      cli: {
        ...context,
        is_ci: Boolean(process.env.CI),
        is_tty: Boolean(process.stdout.isTTY),
      },
    },
    exception: {
      values: [
        {
          type: error.name,
          value: error.message,
          stacktrace: error.stack ? parseStacktrace(error.stack) : undefined,
        },
      ],
    },
    tags: { cli_version: cliVersion, os: runtime, arch: process.arch },
  };

  const eventJson = JSON.stringify(event);

  // Envelope: header \n item-header \n item-payload
  const envelopeHeader = JSON.stringify({
    event_id: eventId,
    dsn: SENTRY_DSN,
    sent_at: new Date().toISOString(),
    sdk: { name: "archgate-cli", version: cliVersion },
  });

  const itemHeader = JSON.stringify({
    type: "event",
    content_type: "application/json",
    length: Buffer.byteLength(eventJson),
  });

  const envelope = `${envelopeHeader}\n${itemHeader}\n${eventJson}`;

  const envelopeUrl = `${parsedDSN.host}/api/${parsedDSN.projectId}/envelope/`;

  await fetch(envelopeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=archgate-cli/${cliVersion}, sentry_key=${parsedDSN.publicKey}`,
    },
    body: envelope,
    signal: AbortSignal.timeout(SENTRY_TIMEOUT_MS),
  });

  logDebug("Sentry event sent:", eventId);
}

// ---------------------------------------------------------------------------
// Stack trace parsing
// ---------------------------------------------------------------------------

interface SentryFrame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

/**
 * Parse a V8/Bun stack trace string into Sentry frame format.
 * Strips absolute paths to relative for privacy.
 */
function parseStacktrace(stack: string): { frames: SentryFrame[] } {
  const frames: SentryFrame[] = [];
  const lines = stack.split("\n");

  for (const line of lines) {
    const match = line.match(/^\s+at\s+(?:(.+?)\s+)?\(?(.+?):(\d+):(\d+)\)?$/);
    if (!match) continue;

    const [, fn, filepath, lineStr, colStr] = match;

    // Strip absolute paths — keep only the relative part from src/ or tests/
    const relPath = stripToRelativePath(filepath ?? "");

    frames.push({
      filename: relPath,
      function: fn ?? "<anonymous>",
      lineno: Number(lineStr),
      colno: Number(colStr),
      in_app: relPath.startsWith("src/") || relPath.startsWith("tests/"),
    });
  }

  // Sentry expects frames in caller-first order (reversed from stack trace)
  return { frames: frames.reverse() };
}

/**
 * Strip an absolute file path to a relative path from the project root.
 * E.g., /home/user/project/src/cli.ts → src/cli.ts
 */
function stripToRelativePath(filepath: string): string {
  // Match common project path segments
  const markers = ["/src/", "/tests/", "/node_modules/"];
  for (const marker of markers) {
    const idx = filepath.lastIndexOf(marker);
    if (idx !== -1) return filepath.slice(idx + 1);
  }
  // Fallback: use the last path component
  const lastSlash = Math.max(
    filepath.lastIndexOf("/"),
    filepath.lastIndexOf("\\")
  );
  return lastSlash === -1 ? filepath : filepath.slice(lastSlash + 1);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Generate a 32-character hex event ID (Sentry format). */
function generateEventId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Testing helpers
// ---------------------------------------------------------------------------

/** Reset Sentry state. For testing only. */
export function _resetSentry(): void {
  initialized = false;
  parsedDSN = null;
}
