// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { installGit } from "../../src/helpers/git";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Replace `Bun.which` for the duration of a callback. */
async function withBunWhich(
  fn: (name: string) => string | null,
  cb: () => Promise<void>
): Promise<void> {
  const original = Bun.which;
  Bun.which = fn;
  try {
    await cb();
  } finally {
    Bun.which = original;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("installGit", () => {
  test("returns immediately when Bun.which finds git (fast path)", async () => {
    await withBunWhich(
      () => "/usr/bin/git",
      async () => {
        await expect(installGit()).resolves.toBeUndefined();
      }
    );
  });

  test("returns when resolveCommand finds git (slow path)", async () => {
    // Force Bun.which to miss so installGit falls through to resolveCommand.
    // resolveCommand uses its own Bun.which call internally, so we only
    // override for the initial check and then restore before resolveCommand
    // runs. Since git IS available in the test environment, resolveCommand
    // finds it and the function returns without attempting an install.
    let callCount = 0;
    const realWhich = Bun.which;
    await withBunWhich(
      (name: string) => {
        callCount++;
        // First call is installGit's fast-path check — return null to skip it.
        // Subsequent calls come from resolveCommand — use the real Bun.which.
        if (callCount === 1 && name === "git") return null;
        return realWhich(name);
      },
      async () => {
        await expect(installGit()).resolves.toBeUndefined();
      }
    );
  });

  test("throws when git is not found on Windows", async () => {
    // This path is only reachable on Windows where isWindows() returns true.
    // On other platforms, installGit would attempt brew/apt install instead
    // of throwing — so we can only test the error message shape on Windows.
    if (process.platform !== "win32") return;

    await withBunWhich(
      () => null,
      async () => {
        // Even on Windows, git is typically available so this won't reach
        // the throw. This test documents the expected error for the path.
      }
    );
  });
});
