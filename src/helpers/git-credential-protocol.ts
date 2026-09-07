// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * git-credential-protocol.ts — parse and format git's credential helper format.
 *
 * @see https://git-scm.com/docs/git-credential
 */

/** Key/value pairs from one credential request. */
export type CredentialRequest = Record<string, string>;

/**
 * Parse the key=value block git writes to a helper's stdin.
 *
 * @param input - Raw stdin contents; parsing stops at the first blank line.
 * @returns The parsed pairs, with unknown keys preserved.
 */
export function parseCredentialRequest(input: string): CredentialRequest {
  const request: CredentialRequest = {};
  for (const line of input.split("\n")) {
    if (line === "") break;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    request[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return request;
}

/**
 * Render a credential answer in the format git expects on stdout.
 *
 * The answer ends with a blank line, the protocol's terminator, so git can
 * stop reading without waiting for end-of-file.
 *
 * @param fields - Pairs to emit; values containing a newline are dropped,
 * since a newline would let a value forge additional protocol lines.
 */
export function formatCredentialResponse(fields: CredentialRequest): string {
  const lines = Object.entries(fields)
    .filter(([, value]) => !value.includes("\n") && !value.includes("\0"))
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
  return `${lines}\n`;
}
