// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

/**
 * Read a byte or string stream to its end as UTF-8 text.
 *
 * Defaults to `process.stdin`, whose Node stream holds a referenced handle for
 * the whole read: a pending `Bun.stdin.text()` does not keep the event loop
 * alive once module evaluation has finished, so a command action awaiting it
 * on a Windows pipe exits 0 with the input unread.
 *
 * @param source - Stream to drain; injectable for tests.
 */
export async function readStdinText(
  source: AsyncIterable<Uint8Array | string> = process.stdin
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of source) {
    text +=
      typeof chunk === "string"
        ? chunk
        : decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}
