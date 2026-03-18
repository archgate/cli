/**
 * tls.ts — Detect TLS/SSL interception errors common in corporate environments
 * and provide actionable guidance to the user.
 */

const TLS_ERROR_PATTERNS = [
  "self signed certificate",
  "unable to get local issuer certificate",
  "certificate has expired",
  "unable to verify the first certificate",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
];

/**
 * Returns true when the error looks like a TLS certificate verification
 * failure — typically caused by a corporate proxy performing SSL inspection.
 */
export function isTlsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return TLS_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

/**
 * Human-readable hint explaining the TLS failure and how to fix it.
 * Shows the correct shell syntax for the current platform.
 */
export function tlsHintMessage(): string {
  const example =
    process.platform === "win32"
      ? '  $env:NODE_EXTRA_CA_CERTS="C:\\path\\to\\corporate-ca.pem"'
      : '  export NODE_EXTRA_CA_CERTS="/path/to/corporate-ca.pem"';

  return [
    "TLS certificate verification failed.",
    "This typically happens behind a corporate proxy that performs SSL inspection.",
    "",
    "To fix this, set the NODE_EXTRA_CA_CERTS environment variable to your corporate CA certificate:",
    "",
    example,
    "",
    "Then retry the command.",
  ].join("\n");
}
