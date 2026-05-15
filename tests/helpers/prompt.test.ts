// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { withPromptFix } from "../../src/helpers/prompt";

describe("withPromptFix", () => {
  test("returns the value from the wrapped function", async () => {
    const result = await withPromptFix(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  test("propagates errors from the wrapped function", async () => {
    await expect(
      withPromptFix(() => Promise.reject(new Error("boom")))
    ).rejects.toThrow("boom");
  });

  // The Windows-specific patching (stream writes + console redirects) is a
  // permanent, idempotent side effect that cannot be meaningfully asserted in
  // unit tests — earlier tests in the full suite may have already triggered it.
  // The behavior is verified manually on Windows PowerShell.
  test.skipIf(process.platform !== "win32")(
    "applies newline patches on Windows (manual verification)",
    async () => {
      await withPromptFix(() => Promise.resolve());
      // On Windows, process.stdout.write should be the patched version.
      // We check the function name rather than reference equality because
      // earlier tests in the suite may have already applied the patch.
      expect(process.stdout.write.name).toBe("patchedWrite");
    }
  );

  test.skipIf(process.platform === "win32")(
    "is a pure passthrough on non-Windows",
    async () => {
      const before = process.stdout.write;
      await withPromptFix(() => Promise.resolve());
      expect(process.stdout.write).toBe(before);
    }
  );
});
