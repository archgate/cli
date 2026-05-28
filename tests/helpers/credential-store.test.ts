// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Verifies that credential-store.ts correctly re-exports from
 * credential-store-impl.ts. The full implementation tests live in
 * credential-store-impl.test.ts — this file only checks the re-export surface.
 */
import { describe, expect, test } from "bun:test";

// Import from the re-export wrapper (credential-store.ts).
// Note: login-flow.test.ts mocks this path via mock.module(), so in a shared
// test process these may be mock functions. The assertions below only check
// that the exports exist and are functions — they don't invoke real behavior.
import {
  saveCredentials,
  loadCredentials,
  clearCredentials,
} from "../../src/helpers/credential-store";

describe("credential-store (re-export surface)", () => {
  test("saveCredentials is exported as a function", () => {
    expect(typeof saveCredentials).toBe("function");
  });

  test("loadCredentials is exported as a function", () => {
    expect(typeof loadCredentials).toBe("function");
  });

  test("clearCredentials is exported as a function", () => {
    expect(typeof clearCredentials).toBe("function");
  });
});
