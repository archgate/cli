// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { resolveSource } from "../../src/helpers/registry";

describe("resolveSource", () => {
  test("resolves official registry path", () => {
    const result = resolveSource("packs/typescript-strict");
    expect(result.kind).toBe("official");
    expect(result.repoUrl).toBe("https://github.com/archgate/awesome-adrs.git");
    expect(result.subpath).toBe("packs/typescript-strict");
    expect(result.ref).toBeUndefined();
  });

  test("resolves official registry cherry-pick path", () => {
    const result = resolveSource(
      "packs/security/adrs/SEC-001-no-secrets-in-code"
    );
    expect(result.kind).toBe("official");
    expect(result.repoUrl).toBe("https://github.com/archgate/awesome-adrs.git");
    expect(result.subpath).toBe(
      "packs/security/adrs/SEC-001-no-secrets-in-code"
    );
  });

  test("resolves GitHub org/repo/path (3 segments)", () => {
    const result = resolveSource("acme/repo/packs/thing");
    expect(result.kind).toBe("github-repo");
    expect(result.repoUrl).toBe("https://github.com/acme/repo.git");
    expect(result.subpath).toBe("packs/thing");
    expect(result.ref).toBeUndefined();
  });

  test("resolves GitHub URL with /tree/<ref>/<path>", () => {
    const result = resolveSource(
      "https://github.com/org/repo/tree/main/packs/x"
    );
    expect(result.kind).toBe("git-url");
    expect(result.repoUrl).toBe("https://github.com/org/repo.git");
    expect(result.ref).toBe("main");
    expect(result.subpath).toBe("packs/x");
  });

  test("extracts @ref from official path", () => {
    const result = resolveSource("packs/typescript-strict@0.3.0");
    expect(result.kind).toBe("official");
    expect(result.subpath).toBe("packs/typescript-strict");
    expect(result.ref).toBe("0.3.0");
  });

  test("extracts @ref from GitHub org/repo/path", () => {
    const result = resolveSource("acme/my-adrs/packs/foo@v1.2.3");
    expect(result.kind).toBe("github-repo");
    expect(result.repoUrl).toBe("https://github.com/acme/my-adrs.git");
    expect(result.subpath).toBe("packs/foo");
    expect(result.ref).toBe("v1.2.3");
  });

  test("plain https URL resolves to git-url kind", () => {
    const result = resolveSource("https://github.com/org/repo");
    expect(result.kind).toBe("git-url");
    expect(result.repoUrl).toBe("https://github.com/org/repo.git");
    expect(result.subpath).toBe(".");
  });

  test("git@ URL resolves to git-url kind", () => {
    const result = resolveSource("git@github.com:org/repo.git");
    expect(result.kind).toBe("git-url");
    expect(result.repoUrl).toBe("git@github.com:org/repo.git");
    expect(result.subpath).toBe(".");
  });

  test("@ref on URL overrides /tree/ ref", () => {
    const result = resolveSource(
      "https://github.com/org/repo/tree/main/packs/x@v2.0.0"
    );
    expect(result.ref).toBe("v2.0.0");
  });

  test("throws on invalid input (no segments)", () => {
    expect(() => resolveSource("just-a-name")).toThrow(
      /Cannot resolve source/u
    );
  });

  test("throws on two-segment input", () => {
    expect(() => resolveSource("org/repo")).toThrow(/Cannot resolve source/u);
  });
});
