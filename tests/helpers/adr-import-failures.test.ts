// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// ---------------------------------------------------------------------------
// Failure paths of the ADR import pipeline: a malformed manifest, a clone that
// aborts partway through a multi-source run, and the rollback that unwinds a
// partially written ADR set.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import * as nodeFs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cleanupTempDirs,
  loadImportsManifest,
  resolveAndCloneSources,
  writeImportedAdrs,
  type AdrToImport,
  type IdMapping,
} from "../../src/helpers/adr-import";
import * as logModule from "../../src/helpers/log";
import * as registry from "../../src/helpers/registry";
import { rejectionMessage } from "../test-utils";

const ADR_MARKDOWN =
  "---\nid: PACK-001\ntitle: Thing\ndomain: general\nrules: false\n---\n\n## Context\n";

describe("loadImportsManifest — malformed manifest", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-manifest-bad-"));
    mkdirSync(join(tempDir, ".archgate"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("rejects a manifest whose entries fail schema validation", async () => {
    writeFileSync(
      join(tempDir, ".archgate", "imports.json"),
      JSON.stringify({ imports: [{ source: 42 }] })
    );

    const message = await rejectionMessage(loadImportsManifest(tempDir));
    expect(message).toContain("Invalid imports manifest at");
    expect(message).toContain("imports.json");
  });
});

describe("resolveAndCloneSources — abort partway through", () => {
  const cloneDirs: string[] = [];

  afterEach(() => {
    for (const dir of cloneDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("removes every clone already made when a later source fails", async () => {
    // Two sources resolving to different repos, so each gets its own clone
    // rather than a cache hit. The first completes; the second aborts, which
    // is what puts an already-successful clone in the cleanup's path.
    const firstClone = mkdtempSync(join(tmpdir(), "archgate-clone-a-"));
    const secondClone = mkdtempSync(join(tmpdir(), "archgate-clone-b-"));
    cloneDirs.push(firstClone, secondClone);

    const cloneSpy = spyOn(registry, "shallowClone")
      .mockResolvedValueOnce(firstClone)
      .mockResolvedValueOnce(secondClone);
    const targetSpy = spyOn(registry, "detectTarget")
      .mockResolvedValueOnce({
        kind: "single-adr",
        adrFile: join(firstClone, "ADR-001.md"),
        rulesFile: null,
        baseDir: firstClone,
      })
      .mockRejectedValueOnce(new Error("no ADRs found at subpath"));

    try {
      const message = await rejectionMessage(
        resolveAndCloneSources(["packs/example", "acme/adrs/backend"])
      );
      expect(message).toBe("no ADRs found at subpath");

      // Clones are transient scratch space — a failed run must not leave any
      // behind, including the ones made before the failing source.
      expect(existsSync(firstClone)).toBe(false);
      expect(existsSync(secondClone)).toBe(false);
      expect(cloneSpy).toHaveBeenCalledTimes(2);
      expect(targetSpy).toHaveBeenCalledTimes(2);
    } finally {
      targetSpy.mockRestore();
      cloneSpy.mockRestore();
    }
  });
});

describe("writeImportedAdrs — rollback", () => {
  const tempDirs: string[] = [];
  let srcDir: string;
  let adrsDir: string;

  beforeEach(() => {
    srcDir = mkdtempSync(join(tmpdir(), "archgate-rollback-src-"));
    adrsDir = mkdtempSync(join(tmpdir(), "archgate-rollback-dest-"));
    tempDirs.push(srcDir, adrsDir);
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * Two ADRs whose destination filenames are `GEN-001-first.md` and
   * `GEN-002-second.md`, so a test can sabotage the second write and observe
   * what happens to the first.
   */
  function twoAdrs(): { adrs: AdrToImport[]; idMap: IdMapping[] } {
    const adrs: AdrToImport[] = [];
    const idMap: IdMapping[] = [];
    const titles = ["First", "Second"];
    for (const [i, title] of titles.entries()) {
      const sourcePath = join(srcDir, `PACK-00${String(i + 1)}.md`);
      writeFileSync(sourcePath, ADR_MARKDOWN);
      adrs.push({
        sourcePath,
        rulesPath: null,
        originalId: `PACK-00${String(i + 1)}`,
        title,
        source: "github:example/pack",
      });
      idMap.push({
        original: `PACK-00${String(i + 1)}`,
        newId: `GEN-00${String(i + 1)}`,
        title,
      });
    }
    return { adrs, idMap };
  }

  test("unlinks already-written files and rethrows when a later write fails", async () => {
    const { adrs, idMap } = twoAdrs();
    // A directory occupying the second ADR's destination path makes its
    // writeFileSync fail after the first ADR has already landed.
    mkdirSync(join(adrsDir, "GEN-002-second.md"));

    const message = await rejectionMessage(
      writeImportedAdrs(adrs, idMap, adrsDir)
    );
    expect(message).toBeTruthy();
    expect(existsSync(join(adrsDir, "GEN-001-first.md"))).toBe(false);
  });

  test("still rethrows when the rollback unlink itself fails", async () => {
    const { adrs, idMap } = twoAdrs();
    mkdirSync(join(adrsDir, "GEN-002-second.md"));

    const unlinkSpy = spyOn(nodeFs, "unlinkSync").mockImplementation(() => {
      throw new Error("EBUSY: file is locked");
    });

    try {
      const message = await rejectionMessage(
        writeImportedAdrs(adrs, idMap, adrsDir)
      );
      // The original write failure is what the caller sees — a best-effort
      // rollback must not mask it with its own error.
      expect(message).not.toContain("EBUSY");
      expect(unlinkSpy).toHaveBeenCalledTimes(1);
    } finally {
      unlinkSpy.mockRestore();
    }
  });
});

describe("cleanupTempDirs — unremovable directory", () => {
  test("logs and continues when a directory cannot be removed", () => {
    const debugSpy = spyOn(logModule, "logDebug").mockImplementation(() => {});
    const rmSpy = spyOn(nodeFs, "rmSync").mockImplementation(() => {
      throw new Error("EPERM: operation not permitted");
    });

    try {
      expect(() => {
        cleanupTempDirs(["/tmp/archgate-locked-clone"]);
      }).not.toThrow();
      expect(debugSpy).toHaveBeenCalledWith(
        "Failed to clean up temp dir:",
        "/tmp/archgate-locked-clone"
      );
    } finally {
      rmSpy.mockRestore();
      debugSpy.mockRestore();
    }
  });
});
