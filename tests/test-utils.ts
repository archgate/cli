// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { rmSync } from "node:fs";

/**
 * Run a git command in the given directory via Bun.spawn (ARCH-007 compliant).
 * Returns stdout as a trimmed string.
 */
export async function git(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const [stdout, stderr, exitCode] = await Promise.all([
    stdoutPromise,
    stderrPromise,
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (exit ${exitCode}): ${stderr.trim()}`
    );
  }
  return stdout.trim();
}

/**
 * Restore an environment variable to a previously captured value, deleting it
 * when that value was `undefined`.
 *
 * `Bun.env.X = undefined` assigns the literal string `"undefined"` rather than
 * unsetting the key, so the common
 * `const orig = Bun.env.X; ... Bun.env.X = orig` idiom silently leaks
 * `X="undefined"` whenever the variable was unset to begin with — which is the
 * normal case on Windows for HOME and GIT_CONFIG_GLOBAL. `Bun.env` is
 * process-global and Bun shares one process across test files, so such a leak
 * escapes into every later test, including subprocesses that inherit the env.
 */
export function restoreEnv(key: string, original: string | undefined): void {
  if (original === undefined) delete Bun.env[key];
  else Bun.env[key] = original;
}

/**
 * Remove a temp directory with retries to handle Windows EBUSY errors
 * caused by git processes that haven't fully released file locks yet.
 */
export function safeRmSync(dir: string, retries = 5): void {
  for (let i = 0; i <= retries; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err: unknown) {
      const code =
        err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
      const isRetryable =
        code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY";
      if (!isRetryable || i === retries) throw err;
      Bun.sleepSync(200 * (i + 1));
    }
  }
}
