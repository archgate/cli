/**
 * Sentry Tunnel — A lightweight reverse proxy for Sentry event ingestion.
 *
 * Receives Sentry envelopes from the CLI, validates the project ID against
 * an allowlist, and forwards them to the real Sentry ingest endpoint. This
 * avoids the CLI hitting sentry.io directly, which improves reliability
 * behind corporate proxies and ad-blockers.
 *
 * Deploy on Railway with a custom domain (e.g. s.archgate.dev).
 *
 * Environment variables:
 *   PORT                    — HTTP port (default: 3000, Railway sets this)
 *   ALLOWED_PROJECT_IDS     — Comma-separated Sentry project IDs to accept
 *   ALLOWED_ORIGINS         — Comma-separated allowed Origin headers (optional, for CORS)
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(Bun.env.PORT ?? "3000", 10);

/** Only forward envelopes destined for these Sentry project IDs. */
const ALLOWED_PROJECT_IDS = new Set(
  (Bun.env.ALLOWED_PROJECT_IDS ?? "").split(",").filter(Boolean)
);

/** Allowed origins for CORS preflight (empty = allow all). */
const ALLOWED_ORIGINS = new Set(
  (Bun.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean)
);

// ---------------------------------------------------------------------------
// Envelope parsing
// ---------------------------------------------------------------------------

interface EnvelopeHeader {
  dsn: string;
}

/**
 * Parse the first line of a Sentry envelope to extract the DSN.
 *
 * Envelope format (newline-delimited):
 *   line 0: JSON header  {"event_id":"...","dsn":"https://key@host/project_id",...}
 *   line 1+: item headers + payloads
 *
 * @see https://develop.sentry.dev/sdk/envelopes/
 */
function parseEnvelopeHeader(body: string): EnvelopeHeader | null {
  const newlineIndex = body.indexOf("\n");
  const headerLine = newlineIndex === -1 ? body : body.slice(0, newlineIndex);

  try {
    const header = JSON.parse(headerLine) as Record<string, unknown>;
    if (typeof header.dsn !== "string") return null;
    return { dsn: header.dsn };
  } catch {
    return null;
  }
}

/**
 * Extract the ingest host and project ID from a Sentry DSN.
 *
 * DSN format: https://<public_key>@<host>/<project_id>
 * Example:    https://abc123@o123.ingest.de.sentry.io/456
 *   → host: o123.ingest.de.sentry.io
 *   → projectId: 456
 */
function parseDsn(dsn: string): { host: string; projectId: string } | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.slice(1); // remove leading "/"
    if (!projectId || !url.hostname) return null;
    return { host: url.hostname, projectId };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Sentry-Auth",
    "Access-Control-Max-Age": "86400",
  };

  if (ALLOWED_ORIGINS.size === 0) {
    // No allowlist → reflect any origin (fine for a write-only ingest proxy)
    headers["Access-Control-Allow-Origin"] = origin ?? "*";
  } else if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin");

    // Health check
    if (url.pathname === "/health" && req.method === "GET") {
      return new Response("ok", { status: 200 });
    }

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Only accept POST to /tunnel (or root /)
    if (
      req.method !== "POST" ||
      (url.pathname !== "/tunnel" && url.pathname !== "/")
    ) {
      return new Response("Not Found", { status: 404 });
    }

    // --- Read and validate the envelope ---

    let body: string;
    try {
      body = await req.text();
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    if (!body) {
      return new Response("Empty body", { status: 400 });
    }

    const envelope = parseEnvelopeHeader(body);
    if (!envelope) {
      return new Response("Invalid envelope header", { status: 400 });
    }

    const dsn = parseDsn(envelope.dsn);
    if (!dsn) {
      return new Response("Invalid DSN in envelope", { status: 400 });
    }

    // Validate project ID against allowlist (if configured)
    if (
      ALLOWED_PROJECT_IDS.size > 0 &&
      !ALLOWED_PROJECT_IDS.has(dsn.projectId)
    ) {
      return new Response("Project not allowed", { status: 403 });
    }

    // --- Forward to Sentry ---

    const upstreamUrl = `https://${dsn.host}/api/${dsn.projectId}/envelope/`;

    try {
      const upstreamResponse = await fetch(upstreamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-sentry-envelope" },
        body,
      });

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: {
          ...corsHeaders(origin),
          "Content-Type":
            upstreamResponse.headers.get("Content-Type") ?? "application/json",
        },
      });
    } catch (err) {
      console.error("Failed to forward to Sentry:", String(err));
      return new Response("Upstream error", { status: 502 });
    }
  },
});

console.log(`Sentry tunnel listening on port ${server.port}`);
