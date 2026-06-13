// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ImportsManifest } from "../../src/formats/pack";
import {
  buildIdMap,
  cleanupTempDirs,
  loadImportsManifest,
  rewriteAdrId,
  saveImportsManifest,
  updateImportsManifest,
  type AdrToImport,
  type IdMapping,
} from "../../src/helpers/adr-import";

describe("rewriteAdrId", () => {
  test("replaces id in YAML frontmatter", () => {
    const content = "---\nid: OLD-001\ntitle: Test\n---\n\n## Context\n";
    const result = rewriteAdrId(content, "OLD-001", "NEW-042");
    expect(result).toContain("id: NEW-042");
    expect(result).not.toContain("OLD-001");
  });

  test("preserves content outside frontmatter", () => {
    const content =
      "---\nid: OLD-001\ntitle: Test\n---\n\n## Context\nBody text with OLD-001 reference.";
    const result = rewriteAdrId(content, "OLD-001", "NEW-042");
    expect(result).toContain("Body text with OLD-001 reference.");
  });

  test("returns content unchanged when no frontmatter found", () => {
    const content = "No frontmatter here.";
    const result = rewriteAdrId(content, "OLD-001", "NEW-042");
    expect(result).toBe(content);
  });

  test("handles frontmatter with Windows-style line endings", () => {
    const content = "---\r\nid: OLD-001\r\ntitle: Test\r\n---\r\n\r\nBody";
    const result = rewriteAdrId(content, "OLD-001", "NEW-042");
    expect(result).toContain("id: NEW-042");
  });
});

describe("buildIdMap", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        /* temp dir cleanup */
      }
    }
  });

  test("assigns sequential IDs for a single domain prefix", () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-idmap-test-"));
    const adrs: AdrToImport[] = [
      {
        sourcePath: "/tmp/a.md",
        rulesPath: null,
        originalId: "TP-001",
        title: "First",
        domain: "architecture",
        source: "packs/test",
      },
      {
        sourcePath: "/tmp/b.md",
        rulesPath: null,
        originalId: "TP-002",
        title: "Second",
        domain: "architecture",
        source: "packs/test",
      },
    ];

    const result = buildIdMap(adrs, tempDir, { architecture: "ARCH" });
    expect(result).toHaveLength(2);
    expect(result[0].newId).toBe("ARCH-001");
    expect(result[1].newId).toBe("ARCH-002");
    expect(result[0].original).toBe("TP-001");
    expect(result[1].original).toBe("TP-002");
  });

  test("skips existing IDs in the adrs directory", () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-idmap-test-"));
    writeFileSync(
      join(tempDir, "ARCH-001-existing.md"),
      "---\nid: ARCH-001\n---\n"
    );

    const adrs: AdrToImport[] = [
      {
        sourcePath: "/tmp/a.md",
        rulesPath: null,
        originalId: "TP-001",
        title: "First",
        domain: "architecture",
        source: "packs/test",
      },
    ];

    const result = buildIdMap(adrs, tempDir, { architecture: "ARCH" });
    expect(result[0].newId).toBe("ARCH-002");
  });

  test("falls back to ARCH prefix when domain has no mapping", () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-idmap-test-"));
    const adrs: AdrToImport[] = [
      {
        sourcePath: "/tmp/a.md",
        rulesPath: null,
        originalId: "X-001",
        title: "Unknown Domain",
        domain: "unknown",
        source: "packs/test",
      },
    ];

    const result = buildIdMap(adrs, tempDir, {});
    expect(result[0].newId).toBe("ARCH-001");
  });

  test("handles multiple domain prefixes independently", () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-idmap-test-"));
    const adrs: AdrToImport[] = [
      {
        sourcePath: "/tmp/a.md",
        rulesPath: null,
        originalId: "A-001",
        title: "Arch Rule",
        domain: "architecture",
        source: "packs/test",
      },
      {
        sourcePath: "/tmp/b.md",
        rulesPath: null,
        originalId: "S-001",
        title: "Sec Rule",
        domain: "security",
        source: "packs/test",
      },
      {
        sourcePath: "/tmp/c.md",
        rulesPath: null,
        originalId: "A-002",
        title: "Arch Rule 2",
        domain: "architecture",
        source: "packs/test",
      },
    ];

    const result = buildIdMap(adrs, tempDir, {
      architecture: "ARCH",
      security: "SEC",
    });
    expect(result[0].newId).toBe("ARCH-001");
    expect(result[1].newId).toBe("SEC-001");
    expect(result[2].newId).toBe("ARCH-002");
  });
});

describe("updateImportsManifest", () => {
  test("adds import entries grouped by source", () => {
    const manifest: ImportsManifest = { imports: [] };
    const adrs: AdrToImport[] = [
      {
        sourcePath: "/tmp/a.md",
        rulesPath: null,
        originalId: "TP-001",
        title: "First",
        source: "packs/test",
        packVersion: "1.0.0",
      },
      {
        sourcePath: "/tmp/b.md",
        rulesPath: null,
        originalId: "TP-002",
        title: "Second",
        source: "packs/test",
        packVersion: "1.0.0",
      },
    ];
    const idMap: IdMapping[] = [
      { original: "TP-001", newId: "ARCH-001", title: "First" },
      { original: "TP-002", newId: "ARCH-002", title: "Second" },
    ];

    updateImportsManifest(manifest, adrs, idMap);

    expect(manifest.imports).toHaveLength(1);
    expect(manifest.imports[0].source).toBe("packs/test");
    expect(manifest.imports[0].version).toBe("1.0.0");
    expect(manifest.imports[0].adrIds).toEqual(["ARCH-001", "ARCH-002"]);
    expect(manifest.imports[0].importedAt).toBeTruthy();
  });

  test("preserves existing manifest entries", () => {
    const manifest: ImportsManifest = {
      imports: [
        {
          source: "packs/existing",
          version: "0.5.0",
          importedAt: "2026-01-01T00:00:00.000Z",
          adrIds: ["GEN-001"],
        },
      ],
    };
    const adrs: AdrToImport[] = [
      {
        sourcePath: "/tmp/a.md",
        rulesPath: null,
        originalId: "TP-001",
        title: "New",
        source: "packs/new",
        packVersion: "2.0.0",
      },
    ];
    const idMap: IdMapping[] = [
      { original: "TP-001", newId: "ARCH-005", title: "New" },
    ];

    updateImportsManifest(manifest, adrs, idMap);

    expect(manifest.imports).toHaveLength(2);
    expect(manifest.imports[0].source).toBe("packs/existing");
    expect(manifest.imports[1].source).toBe("packs/new");
  });
});

describe("loadImportsManifest / saveImportsManifest", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        /* temp dir cleanup */
      }
    }
  });

  test("returns empty manifest when imports.json does not exist", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-manifest-test-"));
    mkdirSync(join(tempDir, ".archgate"), { recursive: true });
    const manifest = await loadImportsManifest(tempDir);
    expect(manifest.imports).toEqual([]);
  });

  test("round-trips a manifest through save and load", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-manifest-test-"));
    mkdirSync(join(tempDir, ".archgate"), { recursive: true });
    const original: ImportsManifest = {
      imports: [
        {
          source: "packs/test",
          version: "1.0.0",
          importedAt: "2026-06-13T00:00:00.000Z",
          adrIds: ["ARCH-001"],
        },
      ],
    };
    saveImportsManifest(tempDir, original);
    const loaded = await loadImportsManifest(tempDir);
    expect(loaded).toEqual(original);
  });
});

describe("cleanupTempDirs", () => {
  test("removes existing directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "archgate-cleanup-test-"));
    writeFileSync(join(dir, "file.txt"), "test");
    expect(existsSync(dir)).toBe(true);
    cleanupTempDirs([dir]);
    expect(existsSync(dir)).toBe(false);
  });

  test("does not throw for non-existent directories", () => {
    expect(() =>
      cleanupTempDirs(["/tmp/nonexistent-archgate-dir"])
    ).not.toThrow();
  });
});
