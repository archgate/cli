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
    // Deliberately incomplete fake Response: isPublicRepo only reads
    // status and json(), so the rest of the Response shape is irrelevant.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = (async () => ({
      status,
      json: async () => body,
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
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
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
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
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

  // Every host parses its 200 body through a Zod schema and swallows a parse
  // failure as "undetermined" rather than guessing at visibility.
  const schemaInvalidCases = [
    {
      host: "github" as const,
      owner: "foo",
      name: "bar",
      body: { private: 1 },
    },
    {
      host: "gitlab" as const,
      owner: "foo",
      name: "bar",
      body: { visibility: 42 },
    },
    {
      host: "bitbucket" as const,
      owner: "foo",
      name: "bar",
      body: { is_private: "no" },
    },
    {
      host: "azure-devops" as const,
      owner: "myorg/myproject",
      name: "myrepo",
      body: { visibility: true },
    },
  ];

  test.each(schemaInvalidCases)(
    "returns null when the $host 200 body fails schema validation",
    async ({ host, owner, name, body }) => {
      mockFetch(200, body);
      _resetPublicProbeCache();
      expect(await isPublicRepo({ host, owner, name })).toBeNull();
    }
  );

  // A status no probe recognises (not 200/401/403/404) falls through to the
  // undetermined default — a 5xx says nothing about visibility.
  const serverErrorCases = [
    { host: "github" as const, owner: "foo", name: "bar" },
    { host: "gitlab" as const, owner: "foo", name: "bar" },
    { host: "bitbucket" as const, owner: "foo", name: "bar" },
    { host: "azure-devops" as const, owner: "myorg/myproject", name: "myrepo" },
  ];

  test.each(serverErrorCases)(
    "returns null when the $host API responds 500",
    async ({ host, owner, name }) => {
      mockFetch(500);
      _resetPublicProbeCache();
      expect(await isPublicRepo({ host, owner, name })).toBeNull();
    }
  );

  test("returns null for a host outside the known switch cases", async () => {
    // Reaches the switch's defensive `default` branch, unreachable through
    // the RepoHost union alone.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const host = "forgejo" as "github";
    mockFetch(200, { private: false });
    _resetPublicProbeCache();
    expect(await isPublicRepo({ host, owner: "foo", name: "bar" })).toBeNull();
  });

  test("swallows an unexpected probe error and reports undetermined", async () => {
    // A Response whose `status` read throws escapes the per-host try/catch
    // (which only wraps body parsing) and lands in probePublic's boundary.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = (async () => ({
      get status(): number {
        throw new Error("response torn down");
      },
      json: async () => ({}),
    })) as unknown as typeof fetch;
    _resetPublicProbeCache();
    expect(
      await isPublicRepo({ host: "github", owner: "foo", name: "bar" })
    ).toBeNull();
  });

  test("caches the result per process (single fetch call)", async () => {
    let calls = 0;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = (async () => {
      calls++;
      return { status: 200, json: async () => ({ private: false }) };
    }) as unknown as typeof fetch;
    _resetPublicProbeCache();

    const repo = { host: "github" as const, owner: "foo", name: "bar" };
    await isPublicRepo(repo);
    await isPublicRepo(repo);
    await isPublicRepo(repo);
    expect(calls).toBe(1);
  });
});
