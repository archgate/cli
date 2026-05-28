// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, mock } from "bun:test";

// Static import — resolves during module graph phase, before mock.module()
// calls in parallel test files (e.g. login-flow.test.ts) can replace the
// module cache entry. The destructured reference is immune to later mocks.
import { pollForAccessToken } from "../../src/helpers/auth";

/** Type-safe fetch mock — Bun's fetch type includes `preconnect` which mock() doesn't provide. */
function mockFetch(handler: () => Promise<Response>) {
  globalThis.fetch = mock(handler) as unknown as typeof fetch;
}

describe("pollForAccessToken", () => {
  test("returns token after authorization_pending then success", async () => {
    const originalFetch = globalThis.fetch;
    const originalSleep = Bun.sleep;
    Bun.sleep = mock(() => Promise.resolve()) as unknown as typeof Bun.sleep;

    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          Response.json({ error: "authorization_pending" })
        );
      }
      return Promise.resolve(
        Response.json({
          access_token: "gho_polled_token",
          token_type: "bearer",
          scope: "read:user",
        })
      );
    }) as unknown as typeof fetch;

    try {
      const token = await pollForAccessToken("dc_abc", 0, 60);
      expect(token).toBe("gho_polled_token");
      expect(callCount).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
      Bun.sleep = originalSleep;
    }
  });

  test("handles slow_down by increasing poll interval", async () => {
    const originalFetch = globalThis.fetch;
    const originalSleep = Bun.sleep;
    const sleepArgs: number[] = [];
    Bun.sleep = mock((ms: number) => {
      sleepArgs.push(ms);
      return Promise.resolve();
    }) as unknown as typeof Bun.sleep;

    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(Response.json({ error: "slow_down" }));
      }
      return Promise.resolve(
        Response.json({
          access_token: "gho_after_slow_down",
          token_type: "bearer",
          scope: "read:user",
        })
      );
    }) as unknown as typeof fetch;

    try {
      const token = await pollForAccessToken("dc_abc", 0, 60);
      expect(token).toBe("gho_after_slow_down");
      // After slow_down, interval increases by 5; second sleep should be 5*1000
      expect(sleepArgs[1]).toBe(5 * 1000);
    } finally {
      globalThis.fetch = originalFetch;
      Bun.sleep = originalSleep;
    }
  });

  test("throws on expired_token", async () => {
    const originalFetch = globalThis.fetch;
    const originalSleep = Bun.sleep;
    Bun.sleep = mock(() => Promise.resolve()) as unknown as typeof Bun.sleep;

    mockFetch(() =>
      Promise.resolve(
        Response.json({
          error: "expired_token",
          error_description: "The device code has expired.",
        })
      )
    );

    try {
      await expect(pollForAccessToken("dc_abc", 0, 60)).rejects.toThrow(
        "The device code has expired."
      );
    } finally {
      globalThis.fetch = originalFetch;
      Bun.sleep = originalSleep;
    }
  });

  test("throws on access_denied", async () => {
    const originalFetch = globalThis.fetch;
    const originalSleep = Bun.sleep;
    Bun.sleep = mock(() => Promise.resolve()) as unknown as typeof Bun.sleep;

    mockFetch(() =>
      Promise.resolve(
        Response.json({
          error: "access_denied",
          error_description: "The user denied your request.",
        })
      )
    );

    try {
      await expect(pollForAccessToken("dc_abc", 0, 60)).rejects.toThrow(
        "The user denied your request."
      );
    } finally {
      globalThis.fetch = originalFetch;
      Bun.sleep = originalSleep;
    }
  });

  test("throws when deadline expires before authorization", async () => {
    const originalFetch = globalThis.fetch;
    const originalSleep = Bun.sleep;
    Bun.sleep = mock(() => Promise.resolve()) as unknown as typeof Bun.sleep;

    mockFetch(() =>
      Promise.resolve(Response.json({ error: "authorization_pending" }))
    );

    try {
      await expect(pollForAccessToken("dc_abc", 0, 0)).rejects.toThrow(
        "Device code expired. Please try again."
      );
    } finally {
      globalThis.fetch = originalFetch;
      Bun.sleep = originalSleep;
    }
  });
});
