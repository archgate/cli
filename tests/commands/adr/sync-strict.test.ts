// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
  type Mock,
} from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";
import { z } from "zod";

import { registerAdrSyncCommand } from "../../../src/commands/adr/sync";

/** Mirrors sync.test.ts's schema: the trusted CLI JSON output shape. */
const SyncStrictJsonSchema = z.object({
  status: z.string(),
  errors: z.number().optional(),
  updated: z.number().optional(),
});
import * as registry from "../../../src/helpers/registry";
import { safeRmSync } from "../../test-utils";

/** Sample ADR markdown with frontmatter. */
function adr(id: string, body: string): string {
  return `---\nid: ${id}\ntitle: Test ADR ${id}\ndomain: architecture\nrules: false\n---\n\n## Context\n\n${body}\n`;
}

/** Write imports.json manifest. */
function writeManifest(
  dir: string,
  imports: { source: string; importedAt?: string; adrIds: string[] }[]
): void {
  const data = {
    imports: imports.map((i) => ({
      source: i.source,
      version: "0.1.0",
      importedAt: i.importedAt ?? "2026-01-15T12:00:00.000Z",
      adrIds: i.adrIds,
    })),
  };
  writeFileSync(
    join(dir, ".archgate", "imports.json"),
    JSON.stringify(data, null, 2) + "\n"
  );
}

/** Create upstream ADR files at `<dir>/<subpath>/adrs/`. */
function scaffoldUpstream(
  dir: string,
  subpath: string,
  adrs: { filename: string; content: string }[]
): void {
  const adrsDir = join(dir, subpath, "adrs");
  mkdirSync(adrsDir, { recursive: true });
  for (const a of adrs) writeFileSync(join(adrsDir, a.filename), a.content);
}

describe("adr sync --strict", () => {
  let tempDir: string;
  let upstreamDir: string;
  let originalCwd: string;
  let logSpy: Mock<typeof console.log>;
  let warnSpy: Mock<typeof console.warn>;
  let errorSpy: Mock<typeof console.error>;
  let exitSpy: Mock<typeof process.exit>;
  let resolveSourceSpy: Mock<typeof registry.resolveSource>;
  let shallowCloneSpy: Mock<typeof registry.shallowClone>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-sync-strict-"));
    upstreamDir = mkdtempSync(join(tmpdir(), "archgate-sync-strict-upstream-"));
    originalCwd = process.cwd();
    Bun.env.ARCHGATE_PROJECT_CEILING = tempDir;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    resolveSourceSpy = spyOn(registry, "resolveSource");
    shallowCloneSpy = spyOn(registry, "shallowClone");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    delete Bun.env.ARCHGATE_PROJECT_CEILING;
    safeRmSync(tempDir);
    safeRmSync(upstreamDir);
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    resolveSourceSpy.mockRestore();
    shallowCloneSpy.mockRestore();
  });

  function scaffold(): void {
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    mkdirSync(join(tempDir, ".archgate", "lint"), { recursive: true });
  }

  function output(): string {
    return logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
  }

  /** Point mocks at upstreamDir with given subpath. */
  function useMocks(subpath: string): void {
    resolveSourceSpy.mockReturnValue({
      kind: "official",
      repoUrl: "https://github.com/archgate/awesome-adrs.git",
      subpath,
    });
    shallowCloneSpy.mockResolvedValue(upstreamDir);
  }

  /** Write a local ADR file into the project's adrs dir. */
  function writeLocal(filename: string, content: string): string {
    const p = join(tempDir, ".archgate", "adrs", filename);
    writeFileSync(p, content);
    return p;
  }

  /** Common setup: scaffold project, chdir, write local + upstream ADR, write manifest. */
  function setupSync(
    localBody: string,
    upstreamBody: string,
    opts?: { id?: string; subpath?: string }
  ): string {
    const id = opts?.id ?? "ARCH-001";
    const sub = opts?.subpath ?? "packs/typescript-strict";
    scaffold();
    process.chdir(tempDir);
    const localPath = writeLocal(`${id}-test.md`, adr(id, localBody));
    writeManifest(tempDir, [{ source: sub, adrIds: [id] }]);
    useMocks(sub);
    scaffoldUpstream(upstreamDir, sub, [
      { filename: `${id}-test.md`, content: adr(id, upstreamBody) },
    ]);
    return localPath;
  }

  async function run(...args: string[]): Promise<void> {
    const parent = new Command("adr").exitOverride();
    registerAdrSyncCommand(parent);
    await parent.parseAsync(["node", "adr", "sync", ...args]);
  }

  /** Manifest referencing an ADR ID with no matching local file — the
   * source resolves and clones fine, so `withChanges` stays 0 but
   * `result.errors` is incremented (findLocalAdr returns null). */
  function setupMissingLocalAdr(): void {
    scaffold();
    process.chdir(tempDir);
    writeManifest(tempDir, [
      { source: "packs/typescript-strict", adrIds: ["ARCH-001"] },
    ]);
    useMocks("packs/typescript-strict");
    scaffoldUpstream(upstreamDir, "packs/typescript-strict", [
      { filename: "ARCH-001-test.md", content: adr("ARCH-001", "Upstream.") },
    ]);
  }

  // --check branch
  test("--check --strict fails when errors > 0 even with withChanges === 0", async () => {
    setupMissingLocalAdr();
    expect(run("--check", "--strict")).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("--check --strict does not fail when errors === 0", async () => {
    setupSync("Same.", "Same.");
    await run("--check", "--strict");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("--check without --strict does not fail on errors (non-regression)", async () => {
    setupMissingLocalAdr();
    await run("--check");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  // "already up to date" early-return path (no --check)
  test("--strict fails in the up-to-date path when errors > 0, and JSON includes errors", async () => {
    setupMissingLocalAdr();
    expect(run("--strict", "--json")).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
    const parsed = SyncStrictJsonSchema.parse(JSON.parse(output()));
    expect(parsed.status).toBe("up-to-date");
    expect(parsed.errors).toBeGreaterThanOrEqual(1);
  });

  test("without --strict, the up-to-date path does not fail on errors (non-regression)", async () => {
    setupMissingLocalAdr();
    await run("--json");
    expect(exitSpy).not.toHaveBeenCalled();
    const parsed = SyncStrictJsonSchema.parse(JSON.parse(output()));
    expect(parsed.errors).toBeGreaterThanOrEqual(1);
  });

  // Interactive/default "synced" path
  test("--yes --strict fails when one import errors even if another synced, and JSON includes errors", async () => {
    scaffold();
    process.chdir(tempDir);
    writeLocal("LOCAL-001-test.md", adr("LOCAL-001", "Old."));
    writeManifest(tempDir, [
      { source: "packs/typescript-strict", adrIds: ["LOCAL-001"] },
      { source: "packs/broken-pack", adrIds: ["ARCH-999"] },
    ]);
    resolveSourceSpy.mockImplementation((input: string) => ({
      kind: "official" as const,
      repoUrl: "https://github.com/archgate/awesome-adrs.git",
      subpath: input,
    }));
    shallowCloneSpy.mockResolvedValue(upstreamDir);
    scaffoldUpstream(upstreamDir, "packs/typescript-strict", [
      { filename: "UP-001-test.md", content: adr("UP-001", "New upstream.") },
    ]);
    // packs/broken-pack has no upstream ADRs dir at all — findLocalAdr for
    // ARCH-999 also fails since it's never written locally, incrementing
    // result.errors.
    expect(run("--yes", "--strict", "--json")).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
    const parsed = SyncStrictJsonSchema.parse(JSON.parse(output()));
    expect(parsed.status).toBe("synced");
    expect(parsed.errors).toBeGreaterThanOrEqual(1);
    expect(parsed.updated).toBeGreaterThanOrEqual(1);
  });

  test("without --strict, the synced path does not fail on errors (non-regression)", async () => {
    scaffold();
    process.chdir(tempDir);
    writeLocal("LOCAL-001-test.md", adr("LOCAL-001", "Old."));
    writeManifest(tempDir, [
      { source: "packs/typescript-strict", adrIds: ["LOCAL-001"] },
      { source: "packs/broken-pack", adrIds: ["ARCH-999"] },
    ]);
    resolveSourceSpy.mockImplementation((input: string) => ({
      kind: "official" as const,
      repoUrl: "https://github.com/archgate/awesome-adrs.git",
      subpath: input,
    }));
    shallowCloneSpy.mockResolvedValue(upstreamDir);
    scaffoldUpstream(upstreamDir, "packs/typescript-strict", [
      { filename: "UP-001-test.md", content: adr("UP-001", "New upstream.") },
    ]);
    await run("--yes", "--json");
    expect(exitSpy).not.toHaveBeenCalled();
    const parsed = SyncStrictJsonSchema.parse(JSON.parse(output()));
    expect(parsed.errors).toBeGreaterThanOrEqual(1);
  });

  // Config-default precedence
  test("strict: true in .archgate/config.json is honored when the flag is omitted", async () => {
    setupMissingLocalAdr();
    writeFileSync(
      join(tempDir, ".archgate", "config.json"),
      JSON.stringify({ domains: {}, strict: true }, null, 2)
    );
    expect(run("--check")).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
