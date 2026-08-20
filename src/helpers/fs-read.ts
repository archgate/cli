// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Absence-tolerant file reads: a missing file yields `null`, decided by an
 * existence check rather than by letting the read reject. Under Bun 1.4 an
 * ENOENT rejection leaves the event loop unreferenced, so a caller whose only
 * pending work is that read exits 0 mid-await having printed nothing. Only
 * absence is absorbed — a file that exists but cannot be read still throws.
 */

import type { BunFile } from "bun";

/**
 * Read a file's text, or `null` when it does not exist.
 *
 * @param path - Path to read.
 * @returns The text, or `null` if there is no such file.
 */
export async function readTextIfExists(path: string): Promise<string | null> {
  return readIfExists(path, async (file) => file.text());
}

/**
 * Read through a caller-supplied reader, or `null` when the file does not
 * exist — for reads that are not plain whole-file text (a byte range, raw
 * bytes, `.json()`).
 *
 * @param path - Path to read.
 * @param read - Performs the read against the resolved `BunFile`.
 * @returns The reader's result, or `null` if there is no such file.
 */
export async function readIfExists<T>(
  path: string,
  read: (file: BunFile) => Promise<T>
): Promise<T | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return read(file);
}
