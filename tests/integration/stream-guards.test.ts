// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * End-to-end broken-pipe behavior: spawns a real bun process that installs
 * the stream guards, then emits a synthetic EPIPE `error` event on
 * `process.stdout` — the same delivery Bun uses when a piped reader closes
 * mid-write. A genuine OS-level pipe close is not portable to arrange from
 * bun:test (a child's cancelled stdout stays open on Windows).
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const GUARDS_URL = pathToFileURL(
  resolve(import.meta.dir, "..", "..", "src", "helpers", "stream-guards.ts")
).href;

/**
 * Run a script body in a fresh bun process and return its exit code. The
 * body can reference `installStreamErrorGuards` after awaiting `guards`.
 */
async function runScript(body: string): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), "archgate-epipe-"));
  const file = join(dir, "script.ts");
  const script = [
    `const { installStreamErrorGuards } = await import(${JSON.stringify(
      GUARDS_URL
    )});`,
    body,
    // Fallback: if the expected exit never happens, fail loudly with a
    // sentinel code no assertion accepts.
    "setTimeout(() => process.exit(99), 3000);",
  ].join("\n");
  writeFileSync(file, script);

  try {
    const proc = Bun.spawn(["bun", file], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "test", ARCHGATE_TELEMETRY: "0" },
    });
    return await proc.exited;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SYNTHETIC_EPIPE = `const err = Object.assign(new Error("EPIPE: broken pipe, write"), {
  code: "EPIPE",
  errno: -32,
  syscall: "write",
});`;

describe("stream guards end-to-end", () => {
  test("guarded process exits 0 on stdout EPIPE", async () => {
    const code = await runScript(
      [
        "installStreamErrorGuards();",
        SYNTHETIC_EPIPE,
        'process.stdout.emit("error", err);',
      ].join("\n")
    );
    expect(code).toBe(0);
  });

  test("unguarded process crashes on stdout EPIPE", async () => {
    // Fire-test the other direction: without the guards the same event is
    // fatal, proving the listener is load-bearing.
    const code = await runScript(
      [SYNTHETIC_EPIPE, 'process.stdout.emit("error", err);'].join("\n")
    );
    expect(code).not.toBe(0);
    expect(code).not.toBe(99);
  });

  test("guarded process still crashes on non-EPIPE stream errors", async () => {
    const code = await runScript(
      [
        "installStreamErrorGuards();",
        'const err = Object.assign(new Error("EIO: i/o error, write"), { code: "EIO" });',
        'process.stdout.emit("error", err);',
      ].join("\n")
    );
    expect(code).not.toBe(0);
    expect(code).not.toBe(99);
  });

  test("guarded process survives stderr EPIPE and finishes its work", async () => {
    const code = await runScript(
      [
        "installStreamErrorGuards();",
        SYNTHETIC_EPIPE,
        'process.stderr.emit("error", err);',
        // Still alive after the swallowed stderr error → normal success exit.
        "process.exit(0);",
      ].join("\n")
    );
    expect(code).toBe(0);
  });
});
