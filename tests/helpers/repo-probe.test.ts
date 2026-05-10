// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, afterEach, beforeEach } from "bun:test";

import {
  _resetPublicProbeCache,
  isPublicRepo,
} from "../../src/helpers/repo-probe";

describe("isPublicRepo", () => {
  // ARCH-005: assign `globalThis.fetch` directly. `mock.module("node:fetch")`
  // does not intercept Bun's runtime fetch.
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    _resetPublicProbeCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetPublicProbeCache();
  });

  /**
   * Helper: build a fake fetch that resolves with a minimal `Response`-ish
   * object. Keeps the individual tests focused on the status + body shape
   * that matters for the assertion.
   */
  function mockFetch(status: number, body: unknown = {}): void {
    globalThis.fetch = (() =>
      Promise.resolve({
        status,
        json: () => Promise.resolve(body),
      })) as unknown as typeof fetch;
  }

  test("returns null for repos with missing host/owner/name", async () => {
    expect(
      await isPublicRepo({ host: null, owner: null, name: null })
    ).toBeNull();
    expect(
      await isPublicRepo({ host: "github", owner: null, name: "bar" })
    ).toBeNull();
  });

  test("returns null for unrecognised hosts", async () => {
    _resetPublicProbeCache();
    expect(
      await isPublicRepo({ host: "other", owner: "foo", name: "bar" })
    ).toBeNull();
  });

  test("returns true when GitHub API responds with {private: false}", async () => {
    mockFetch(200, { private: false });
    _resetPublicProbeCache();
    expect(
      await isPublicRepo({ host: "github", owner: "foo", name: "bar" })
    ).toBe(true);
  });

  test("returns false for a 404 (private or nonexistent)", async () => {
    mockFetch(404);
    _resetPublicProbeCache();
    expect(
      await isPublicRepo({ host: "github", owner: "foo", name: "bar" })
    ).toBe(false);
  });

  test("returns null on rate-limit (403)", async () => {
    mockFetch(403);
    _resetPublicProbeCache();
    expect(
      await isPublicRepo({ host: "github", owner: "foo", name: "bar" })
    ).toBeNull();
  });

  test("returns null on network error", async () => {
    globalThis.fetch = (() =>
      Promise.reject(
        new Error("connect ECONNREFUSED")
      )) as unknown as typeof fetch;
    _resetPublicProbeCache();
    expect(
      await isPublicRepo({ host: "github", owner: "foo", name: "bar" })
    ).toBeNull();
  });

  test("recognises GitLab visibility=public", async () => {
    mockFetch(200, { visibility: "public" });
    _resetPublicProbeCache();
    expect(
      await isPublicRepo({ host: "gitlab", owner: "foo", name: "bar" })
    ).toBe(true);
  });

  test("recognises Bitbucket is_private=false", async () => {
    mockFetch(200, { is_private: false });
    _resetPublicProbeCache();
    expect(
      await isPublicRepo({ host: "bitbucket", owner: "foo", name: "bar" })
    ).toBe(true);
  });

  test("recognises Azure DevOps visibility=public", async () => {
    mockFetch(200, { visibility: "public" });
    _resetPublicProbeCache();
    expect(
      await isPublicRepo({
        host: "azure-devops",
        owner: "myorg/myproject",
        name: "myrepo",
      })
    ).toBe(true);
  });

  test("Azure DevOps 401 (auth required) is treated as private", async () => {
    mockFetch(401);
    _resetPublicProbeCache();
    expect(
      await isPublicRepo({
        host: "azure-devops",
        owner: "myorg/myproject",
        name: "myrepo",
      })
    ).toBe(false);
  });

  test("Azure DevOps probe returns null when owner isn't org/project", async () => {
    // Even if somehow classified, a single-segment owner can't resolve
    // to an organization + project pair — refuse to guess.
    globalThis.fetch = (() => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch;
    _resetPublicProbeCache();
    expect(
      await isPublicRepo({
        host: "azure-devops",
        owner: "onlyorg",
        name: "repo",
      })
    ).toBeNull();
  });

  test("caches the result per process (single fetch call)", async () => {
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      return Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ private: false }),
      });
    }) as unknown as typeof fetch;
    _resetPublicProbeCache();

    const repo = { host: "github" as const, owner: "foo", name: "bar" };
    await isPublicRepo(repo);
    await isPublicRepo(repo);
    await isPublicRepo(repo);
    expect(calls).toBe(1);
  });
});
