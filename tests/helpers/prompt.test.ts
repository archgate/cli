// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { withPromptFix } from "../../src/helpers/prompt";

describe("withPromptFix", () => {
  test("returns the value from the wrapped function", async () => {
    const result = await withPromptFix(async () => 42);
    expect(result).toBe(42);
  });

  test("propagates errors from the wrapped function", async () => {
    expect(
      withPromptFix(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
  });

  test.skipIf(process.platform !== "win32")(
    "applies newline patches on Windows",
    async () => {
      await withPromptFix(async () => {});
      expect(process.stdout.write.name).toBe("patchedWrite");
    }
  );

  test.skipIf(process.platform === "win32")(
    "does not apply newline patches on non-Windows",
    async () => {
      // Captured for identity comparison only, never invoked unbound.
      // oxlint-disable-next-line typescript/unbound-method
      const before = process.stdout.write;
      await withPromptFix(async () => {});
      // oxlint-disable-next-line typescript/unbound-method
      expect(process.stdout.write).toBe(before);
    }
  );
});
