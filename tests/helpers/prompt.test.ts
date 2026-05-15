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
});
