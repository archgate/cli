// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * prompt.ts — Windows terminal fix for inquirer prompts.
 *
 * When inquirer creates a readline interface on Windows, the runtime enables
 * Virtual Terminal Processing (VTP) on the console output handle. VTP mode
 * sets the `DISABLE_NEWLINE_AUTO_RETURN` flag, which causes bare `\n` (LF)
 * to move the cursor down WITHOUT returning to column 0. The runtime never
 * restores the original console mode when the readline closes — so ALL
 * subsequent output is affected, not just the prompt itself.
 *
 * This is a runtime bug (Node.js/Bun should restore the console mode in
 * rl.close()), tracked upstream at:
 *   https://github.com/SBoudrias/Inquirer.js/issues/2123
 *
 * Until the runtime fixes this, we work around it by:
 *
 * 1. Patching `process.stdout.write` / `process.stderr.write` to translate
 *    bare `\n` → `\r\n`. This fixes inquirer's own rendering (which writes
 *    through the JS stream API) and any code that uses the stream API.
 *
 * 2. Redirecting `console.log`, `.error`, `.warn`, `.info`, `.debug` through
 *    the patched stream writes. Bun's native console methods write directly
 *    to the file descriptor for performance, bypassing the JS stream API —
 *    so the stream-level patch alone cannot fix them.
 *
 * Both patches are applied once (idempotent) and persist for the lifetime
 * of the process.
 *
 * `withPromptFix()` ensures the patches are active before running a prompt
 * and resets the cursor to column 0 afterward.
 */

import { cursorTo } from "node:readline";
import { format } from "node:util";

import { isWindows } from "./platform";

// ---------------------------------------------------------------------------
// LF → CRLF translation
// ---------------------------------------------------------------------------

/** Regex that matches bare LF (not preceded by CR). */
const BARE_LF = /(?<!\r)\n/gu;

/** Replace bare `\n` with `\r\n` in a string. */
function toCrlf(text: string): string {
  return text.replaceAll(BARE_LF, "\r\n");
}

// ---------------------------------------------------------------------------
// One-time patches (idempotent)
// ---------------------------------------------------------------------------

/** Whether the patches have already been applied. */
let patched = false;

/**
 * On Windows, apply a permanent, idempotent patch so that ALL console output
 * uses `\r\n` instead of bare `\n`. Covers:
 *
 * - `process.stdout.write` / `process.stderr.write` (stream-level — used by
 *   inquirer's readline pipeline)
 * - `console.log` / `.info` / `.error` / `.warn` / `.debug` (console-level —
 *   Bun writes these directly to the fd, bypassing the JS stream API)
 *
 * On non-Windows platforms this is a no-op. Calling it multiple times is safe.
 */
function ensureNewlinePatches(): void {
  if (patched) return;
  patched = true;

  patchStreamWrite(process.stdout);
  patchStreamWrite(process.stderr);
  patchConsoleMethods();
}

// ---------------------------------------------------------------------------
// Stream-level patch
// ---------------------------------------------------------------------------

function patchStreamWrite(stream: NodeJS.WriteStream): void {
  const original = stream.write;
  stream.write = function patchedWrite(
    this: NodeJS.WriteStream,
    chunk: unknown,
    ...rest: unknown[]
  ): boolean {
    if (typeof chunk === "string") {
      chunk = toCrlf(chunk);
    }
    return original.apply(this, [chunk, ...rest] as unknown as [
      string,
      BufferEncoding?,
      ((err?: Error | null) => void)?,
    ]);
  } as typeof stream.write;
}

// ---------------------------------------------------------------------------
// Console-level patch
// ---------------------------------------------------------------------------

/**
 * Redirect `console.log`, `.info`, `.error`, `.warn`, and `.debug` through
 * `process.stdout.write` / `process.stderr.write` so the stream-level
 * `\n` → `\r\n` translation applies to them as well.
 *
 * Bun's native console methods write directly to the file descriptor for
 * performance, bypassing the JavaScript stream API entirely. Without this
 * redirect, patching `process.stdout.write` has no effect on `console.log`.
 */
function patchConsoleMethods(): void {
  for (const method of ["log", "info"] as const) {
    console[method] = ((...args: unknown[]) => {
      process.stdout.write(format(...args) + "\n");
    }) as typeof console.log;
  }
  for (const method of ["error", "warn", "debug"] as const) {
    console[method] = ((...args: unknown[]) => {
      process.stderr.write(format(...args) + "\n");
    }) as typeof console.error;
  }
}

// ---------------------------------------------------------------------------
// High-level wrapper
// ---------------------------------------------------------------------------

/**
 * Execute an async function (typically an `inquirer.prompt()` call) with the
 * Windows newline fix active. The patches are applied once and persist — they
 * are NOT removed after the prompt because the runtime permanently changes
 * the console mode. After the function resolves, the cursor is reset to
 * column 0 (another quirk where the cursor is left at a non-zero column
 * after a prompt answer is rendered).
 *
 * On non-Windows platforms only the cursor reset is applied.
 */
export async function withPromptFix<T>(fn: () => Promise<T>): Promise<T> {
  if (!isWindows()) return fn();

  ensureNewlinePatches();
  const result = await fn();
  resetCursor();
  return result;
}

// ---------------------------------------------------------------------------
// Cursor reset
// ---------------------------------------------------------------------------

function resetCursor(): void {
  if (process.stdout.isTTY) cursorTo(process.stdout, 0);
}
