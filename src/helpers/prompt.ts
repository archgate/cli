// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Windows terminal fix for inquirer prompts: patches stream writes (LF → CRLF)
 * and redirects console methods through them, because a prompt permanently
 * leaves the console in a mode where bare LF does not return the cursor to
 * column 0. Full background and the wrapper contract live in ARCH-019
 * (.archgate/adrs/ARCH-019-inquirer-prompt-fix.md).
 */

import { cursorTo } from "node:readline";
import { format } from "node:util";

import { isWindows } from "./platform";

// ---------------------------------------------------------------------------
// LF → CRLF translation
// ---------------------------------------------------------------------------

const BARE_LF = /(?<!\r)\n/gu;

function toCrlf(text: string): string {
  return text.replaceAll(BARE_LF, "\r\n");
}

// ---------------------------------------------------------------------------
// One-time patches (idempotent)
// ---------------------------------------------------------------------------

let patched = false;

/**
 * Apply a permanent, idempotent patch so ALL console output uses `\r\n`:
 * stream-level (`process.stdout.write` / `process.stderr.write`) plus
 * console-level (`console.log` etc., which Bun writes straight to the fd,
 * bypassing the JS stream API). Safe to call multiple times.
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
  stream.write = new Proxy(original, {
    apply(target, thisArg, args: unknown[]) {
      if (typeof args[0] === "string") {
        args[0] = toCrlf(args[0]);
      }
      return Reflect.apply(target, thisArg, args);
    },
    get(target, prop, receiver) {
      if (prop === "name") return "patchedWrite";
      return Reflect.get(target, prop, receiver);
    },
  });
}

// ---------------------------------------------------------------------------
// Console-level patch
// ---------------------------------------------------------------------------

/**
 * Redirect `console.log`, `.info`, `.error`, `.warn`, and `.debug` through
 * the patched stream writes. Bun's native console methods write directly to
 * the file descriptor, so the stream-level patch alone cannot reach them.
 */
function patchConsoleMethods(): void {
  for (const method of ["log", "info"] as const) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console[method] = (...args: any[]) => {
      process.stdout.write(format(...args) + "\n");
    };
  }
  for (const method of ["error", "warn", "debug"] as const) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console[method] = (...args: any[]) => {
      process.stderr.write(format(...args) + "\n");
    };
  }
}

// ---------------------------------------------------------------------------
// High-level wrapper
// ---------------------------------------------------------------------------

/**
 * Execute an async function (typically an `inquirer.prompt()` call) with the
 * Windows newline fix active, then reset the cursor to column 0. The patches
 * persist for the process lifetime because the console-mode change they
 * compensate for is itself permanent (ARCH-019). No-op on non-Windows.
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
