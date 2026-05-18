// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectTarget, resolveSource } from "../../src/helpers/registry";

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

  test("git@ URL with @ref suffix extracts the ref", () => {
    const result = resolveSource("git@github.com:org/repo.git@v1.0.0");
    expect(result.kind).toBe("git-url");
    expect(result.repoUrl).toBe("git@github.com:org/repo.git");
    expect(result.ref).toBe("v1.0.0");
    expect(result.subpath).toBe(".");
  });

  test("plain https URL ending with .git keeps the suffix", () => {
    const result = resolveSource("https://github.com/org/repo.git");
    expect(result.kind).toBe("git-url");
    expect(result.repoUrl).toBe("https://github.com/org/repo.git");
    expect(result.subpath).toBe(".");
    expect(result.ref).toBeUndefined();
  });

  test("GitHub /tree/ URL with nested subpath", () => {
    const result = resolveSource(
      "https://github.com/acme/adrs/tree/release/v2/packs/security/adrs"
    );
    expect(result.kind).toBe("git-url");
    expect(result.repoUrl).toBe("https://github.com/acme/adrs.git");
    expect(result.ref).toBe("release");
    expect(result.subpath).toBe("v2/packs/security/adrs");
  });

  test("https URL with @ref suffix", () => {
    const result = resolveSource("https://github.com/org/repo@feature-branch");
    expect(result.kind).toBe("git-url");
    expect(result.repoUrl).toBe("https://github.com/org/repo.git");
    expect(result.ref).toBe("feature-branch");
    expect(result.subpath).toBe(".");
  });

  test("git@ URL without .git extension appends .git", () => {
    const result = resolveSource("git@github.com:org/repo");
    expect(result.kind).toBe("git-url");
    expect(result.repoUrl).toBe("git@github.com:org/repo.git");
    expect(result.subpath).toBe(".");
  });
});

describe("detectTarget", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        /* temp dir may already be removed */
      }
    }
  });

  test("detects a pack directory with adrs", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-registry-test-"));
    const packDir = join(tempDir, "my-pack");
    const adrsDir = join(packDir, "adrs");
    mkdirSync(adrsDir, { recursive: true });

    writeFileSync(
      join(packDir, "archgate-pack.yaml"),
      [
        "name: my-pack",
        "version: 0.1.0",
        "description: A test pack",
        "maintainers:",
        "  - github: testuser",
      ].join("\n")
    );
    writeFileSync(
      join(adrsDir, "TEST-001-example.md"),
      "---\nid: TEST-001\n---\n"
    );
    writeFileSync(
      join(adrsDir, "TEST-001-example.rules.ts"),
      "export default {};"
    );

    const result = await detectTarget(tempDir, "my-pack");

    expect(result.kind).toBe("pack");
    if (result.kind === "pack") {
      expect(result.packMeta.name).toBe("my-pack");
      expect(result.packMeta.version).toBe("0.1.0");
      expect(result.adrFiles).toHaveLength(1);
      expect(result.adrFiles[0]).toEndWith("TEST-001-example.md");
      expect(result.rulesFiles).toHaveLength(1);
      expect(result.rulesFiles[0]).toEndWith("TEST-001-example.rules.ts");
      expect(result.baseDir).toBe(adrsDir);
    }
  });

  test("detects a pack with no adrs directory", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-registry-test-"));
    const packDir = join(tempDir, "empty-pack");
    mkdirSync(packDir, { recursive: true });

    writeFileSync(
      join(packDir, "archgate-pack.yaml"),
      [
        "name: empty-pack",
        "version: 1.0.0",
        "description: Pack with no adrs dir",
        "maintainers:",
        "  - github: someone",
      ].join("\n")
    );

    const result = await detectTarget(tempDir, "empty-pack");

    expect(result.kind).toBe("pack");
    if (result.kind === "pack") {
      expect(result.adrFiles).toHaveLength(0);
      expect(result.rulesFiles).toHaveLength(0);
    }
  });

  test("detects a single ADR file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-registry-test-"));
    writeFileSync(
      join(tempDir, "SINGLE-001-my-adr.md"),
      "---\nid: SINGLE-001\n---\n"
    );

    const result = await detectTarget(tempDir, "SINGLE-001-my-adr.md");

    expect(result.kind).toBe("single-adr");
    if (result.kind === "single-adr") {
      expect(result.adrFile).toEndWith("SINGLE-001-my-adr.md");
      expect(result.rulesFile).toBeNull();
    }
  });

  test("detects a single ADR with companion .rules.ts", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-registry-test-"));
    writeFileSync(
      join(tempDir, "RULE-001-tested.md"),
      "---\nid: RULE-001\n---\n"
    );
    writeFileSync(
      join(tempDir, "RULE-001-tested.rules.ts"),
      "export default {};"
    );

    const result = await detectTarget(tempDir, "RULE-001-tested.md");

    expect(result.kind).toBe("single-adr");
    if (result.kind === "single-adr") {
      expect(result.adrFile).toEndWith("RULE-001-tested.md");
      expect(result.rulesFile).not.toBeNull();
      expect(result.rulesFile).toEndWith("RULE-001-tested.rules.ts");
    }
  });

  test("resolves single ADR without .md extension in subpath", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-registry-test-"));
    writeFileSync(
      join(tempDir, "EXT-001-implicit.md"),
      "---\nid: EXT-001\n---\n"
    );

    const result = await detectTarget(tempDir, "EXT-001-implicit");

    expect(result.kind).toBe("single-adr");
    if (result.kind === "single-adr") {
      expect(result.adrFile).toEndWith("EXT-001-implicit.md");
    }
  });

  test("throws when subpath is neither a pack nor an ADR", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-registry-test-"));
    mkdirSync(join(tempDir, "empty-dir"));

    await expect(detectTarget(tempDir, "empty-dir")).rejects.toThrow(
      /Cannot detect import target/u
    );
  });

  test("throws when subpath does not exist", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-registry-test-"));

    await expect(detectTarget(tempDir, "nonexistent")).rejects.toThrow(
      /Cannot detect import target/u
    );
  });
});
