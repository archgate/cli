// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * prompt.ts — Windows terminal fix for inquirer prompts.
 *
 * When inquirer creates a readline interface on Windows, it enables Virtual
 * Terminal Processing (VTP) on the console output handle. VTP mode sets the
 * `DISABLE_NEWLINE_AUTO_RETURN` flag, which causes bare `\n` (LF) to move the
 * cursor down WITHOUT returning to column 0. Crucially, inquirer never restores
 * the original console mode after the prompt closes — so ALL subsequent output
 * is affected, not just the prompt itself.
 *
 * The fix uses two complementary strategies:
 *
 * 1. **Stream-level patch** (applied once, persists): patches
 *    `process.stdout.write` / `process.stderr.write` to translate bare
 *    `\n` → `\r\n`. This covers inquirer's own rendering, which writes
 *    through the JS stream API while `DISABLE_NEWLINE_AUTO_RETURN` is set.
 *
 * 2. **Console mode reset** (after each prompt): uses Bun FFI to call the
 *    Windows `SetConsoleMode` API and clear the `DISABLE_NEWLINE_AUTO_RETURN`
 *    flag. This restores correct newline behavior for ALL output — including
 *    Bun's native `console.log` which bypasses the JS stream API entirely.
 *    If FFI is unavailable (e.g., running under mintty where stdout is a
 *    pipe, not a console handle), falls back to redirecting `console.*`
 *    methods through the patched stream writes.
 *
 * `withPromptFix()` ensures the stream patches are active before running a
 * prompt, resets the console mode afterward, and moves the cursor to column 0.
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
// Stream-level patch (applied once, persists)
// ---------------------------------------------------------------------------

/** Whether the stream-level patches have been applied. */
let streamPatched = false;

/**
 * Patch `process.stdout.write` and `process.stderr.write` to translate bare
 * `\n` → `\r\n`. Applied once and persists — needed because inquirer writes
 * through the JS stream API while `DISABLE_NEWLINE_AUTO_RETURN` is active.
 */
function ensureStreamPatches(): void {
  if (streamPatched) return;
  streamPatched = true;
  patchStreamWrite(process.stdout);
  patchStreamWrite(process.stderr);
}

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
// Console mode reset via Windows API (after each prompt)
// ---------------------------------------------------------------------------

const STD_OUTPUT_HANDLE = -11;
const STD_ERROR_HANDLE = -12;
/** @see https://learn.microsoft.com/en-us/windows/console/setconsolemode */
const DISABLE_NEWLINE_AUTO_RETURN = 0x0008;

/**
 * Clear the `DISABLE_NEWLINE_AUTO_RETURN` flag on the stdout and stderr
 * console handles via the Windows `SetConsoleMode` API (Bun FFI).
 *
 * This restores the default behavior where `\n` returns the cursor to
 * column 0, fixing all native output (including Bun's `console.log` which
 * bypasses the JS stream API).
 *
 * Returns `true` if the reset succeeded, `false` if FFI was unavailable
 * (e.g., stdout is a pipe under mintty, not a real console handle).
 */
function resetConsoleNewlineMode(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { dlopen, FFIType, ptr } =
      require("bun:ffi") as typeof import("bun:ffi");
    const kernel32 = dlopen("kernel32.dll", {
      GetStdHandle: { args: [FFIType.i32], returns: FFIType.ptr },
      GetConsoleMode: {
        args: [FFIType.ptr, FFIType.ptr],
        returns: FFIType.i32,
      },
      SetConsoleMode: {
        args: [FFIType.ptr, FFIType.u32],
        returns: FFIType.i32,
      },
    });

    const modeBuffer = new Uint32Array(1);
    let reset = false;

    for (const handleId of [STD_OUTPUT_HANDLE, STD_ERROR_HANDLE]) {
      const handle = kernel32.symbols.GetStdHandle(handleId);
      const ok = kernel32.symbols.GetConsoleMode(handle, ptr(modeBuffer));
      if (!ok) continue; // not a console handle (e.g., pipe under mintty)
      const mode = modeBuffer[0];
      if (mode & DISABLE_NEWLINE_AUTO_RETURN) {
        kernel32.symbols.SetConsoleMode(
          handle,
          mode & ~DISABLE_NEWLINE_AUTO_RETURN
        );
        reset = true;
      }
    }

    kernel32.close();
    return reset || true; // true = FFI worked (even if flag wasn't set)
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Console-method fallback (only when FFI is unavailable)
// ---------------------------------------------------------------------------

/** Whether the console-method fallback has been applied. */
let consoleFallbackApplied = false;

/**
 * Redirect `console.log`, `.info`, `.error`, `.warn`, `.debug` through the
 * patched `process.stdout.write` / `process.stderr.write`. Only used as a
 * fallback when `resetConsoleNewlineMode()` fails (FFI unavailable).
 *
 * Bun's native console methods write directly to the file descriptor,
 * bypassing the JS stream API. Without this fallback, the stream-level
 * patch has no effect on `console.log` output.
 */
function ensureConsoleFallback(): void {
  if (consoleFallbackApplied) return;
  consoleFallbackApplied = true;

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
 * Windows newline fix active.
 *
 * - **Before:** ensures the stream-level `\n` → `\r\n` patches are active.
 * - **After:** resets the console mode via FFI (clearing the flag inquirer
 *   set), then resets the cursor to column 0.
 *
 * On non-Windows platforms only the cursor reset is applied.
 */
export async function withPromptFix<T>(fn: () => Promise<T>): Promise<T> {
  if (isWindows()) {
    ensureStreamPatches();
  }
  const result = await fn();
  if (isWindows()) {
    const ffiWorked = resetConsoleNewlineMode();
    if (!ffiWorked) ensureConsoleFallback();
  }
  resetCursor();
  return result;
}

// ---------------------------------------------------------------------------
// Cursor reset
// ---------------------------------------------------------------------------

function resetCursor(): void {
  if (process.stdout.isTTY) cursorTo(process.stdout, 0);
}
