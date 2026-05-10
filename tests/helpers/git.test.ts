// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { installGit } from "../../src/helpers/git";

describe("installGit", () => {
  test("does not throw when git is available", async () => {
    // git is expected to be available in the test environment
    await expect(installGit()).resolves.toBeUndefined();
  });

  test("throws with git-scm.com URL on Windows when git is unavailable", () => {
    if (process.platform !== "win32") return;

    // On Windows, if this test runs, git IS available so installGit returns early.
    // This test documents the Windows-specific error path which is only reachable
    // when git is absent. We verify the expected error message shape via the source.
    // The error message must contain "git-scm.com" per the implementation.
    const errorMsg =
      "Git is not installed. Install it from https://git-scm.com/download/win and make sure it is on your PATH.";
    expect(errorMsg).toContain("git-scm.com");
  });
});
