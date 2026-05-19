// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

// Module mocks — declared before imports that depend on them.
const mockShallowClone =
  mock<(repoUrl: string, ref?: string) => Promise<string>>();
const mockResolveSource =
  mock<
    (input: string) => {
      kind: "official" | "github-repo" | "git-url";
      repoUrl: string;
      ref?: string;
      subpath: string;
    }
  >();
mock.module("../../../src/helpers/registry", () => ({
  resolveSource: mockResolveSource,
  shallowClone: mockShallowClone,
}));

import { registerAdrSyncCommand } from "../../../src/commands/adr/sync";
import { safeRmSync } from "../../test-utils";

/** Sample ADR markdown with frontmatter. */
function adr(id: string, body: string): string {
  return `---\nid: ${id}\ntitle: Test ADR ${id}\ndomain: architecture\nrules: false\n---\n\n## Context\n\n${body}\n`;
}

/** Sample ADR with explicit Decision section for diff-summary tests. */
function adrWithSections(
  id: string,
  context: string,
  decision: string
): string {
  return [
    `---\nid: ${id}\ntitle: Test\ndomain: architecture\nrules: false\n---`,
    `\n## Context\n\n${context}\n\n## Decision\n\n${decision}\n`,
  ].join("");
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

describe("adr sync command", () => {
  let tempDir: string;
  let upstreamDir: string;
  let originalCwd: string;
  let logSpy: ReturnType<typeof spyOn>;
  let warnSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-sync-"));
    upstreamDir = mkdtempSync(join(tmpdir(), "archgate-upstream-"));
    originalCwd = process.cwd();
    Bun.env.ARCHGATE_PROJECT_CEILING = tempDir;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    mockShallowClone.mockReset();
    mockResolveSource.mockReset();
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
  });

  function scaffold(): void {
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    mkdirSync(join(tempDir, ".archgate", "lint"), { recursive: true });
  }

  function output(): string {
    return logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
  }

  function warnings(): string {
    return warnSpy.mock.calls
      .map((c: unknown[]) => c.map(String).join(" "))
      .join("\n");
  }

  /** Point mocks at upstreamDir with given subpath. */
  function useMocks(subpath: string): void {
    mockResolveSource.mockReturnValue({
      kind: "official",
      repoUrl: "https://github.com/archgate/awesome-adrs.git",
      subpath,
    });
    mockShallowClone.mockResolvedValue(upstreamDir);
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

  function run(...args: string[]): Promise<void> {
    const parent = new Command("adr").exitOverride();
    registerAdrSyncCommand(parent);
    return parent.parseAsync([
      "node",
      "adr",
      "sync",
      ...args,
    ]) as unknown as Promise<void>;
  }

  // Registration
  test("registers sync command with correct options", () => {
    const parent = new Command("adr").exitOverride();
    registerAdrSyncCommand(parent);
    const sync = parent.commands.find((c) => c.name() === "sync")!;
    expect(sync.description()).toBe(
      "Check for upstream updates to imported ADRs"
    );
    const opts = sync.options.map((o) => o.long);
    expect(opts).toContain("--check");
    expect(opts).toContain("--yes");
    expect(opts).toContain("--json");
  });

  // No project / empty imports
  test("exits with error when .archgate/ is missing", async () => {
    process.chdir(tempDir);
    await expect(run()).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("prints empty message when no imports exist", async () => {
    scaffold();
    process.chdir(tempDir);
    await run();
    expect(output()).toContain("No imported ADRs found.");
  });

  test("prints empty JSON when no imports exist with --json", async () => {
    scaffold();
    process.chdir(tempDir);
    await run("--json");
    const parsed = JSON.parse(output());
    expect(parsed.status).toBe("empty");
    expect(parsed.message).toBe("No imported ADRs found.");
  });

  // Source filtering
  test("source filter no-match prints plain message", async () => {
    scaffold();
    process.chdir(tempDir);
    writeManifest(tempDir, [
      { source: "packs/typescript-strict", adrIds: ["ARCH-001"] },
    ]);
    await run("packs/nonexistent");
    expect(output()).toContain("No imports match the given source filter(s).");
  });

  test("source filter no-match returns JSON when --json", async () => {
    scaffold();
    process.chdir(tempDir);
    writeManifest(tempDir, [
      { source: "packs/typescript-strict", adrIds: ["ARCH-001"] },
    ]);
    await run("--json", "packs/nonexistent");
    expect(JSON.parse(output()).status).toBe("no-match");
  });

  test("--source limits which imports are checked", async () => {
    scaffold();
    process.chdir(tempDir);
    const body = "Same.";
    writeLocal("ARCH-001-test.md", adr("ARCH-001", body));
    writeManifest(tempDir, [
      { source: "packs/typescript-strict", adrIds: ["ARCH-001"] },
      { source: "packs/other-pack", adrIds: ["ARCH-002"] },
    ]);
    useMocks("packs/typescript-strict");
    scaffoldUpstream(upstreamDir, "packs/typescript-strict", [
      { filename: "ARCH-001-test.md", content: adr("ARCH-001", body) },
    ]);
    await run("--check", "packs/typescript-strict");
    expect(output()).toContain("up to date");
    expect(mockShallowClone).toHaveBeenCalledTimes(1);
  });

  // --check mode
  test("--check with upstream matching local → up to date, exit 0", async () => {
    setupSync("Identical.", "Identical.");
    await run("--check");
    expect(output()).toContain("up to date");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("--check with upstream changes → exit 1", async () => {
    setupSync("Local.", "Updated upstream.");
    await expect(run("--check")).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(output()).toContain("ARCH-001");
    expect(output()).toContain("upstream updates");
  });

  test("--check --json with changes → updates-available JSON", async () => {
    setupSync("Local.", "Changed upstream.");
    await expect(run("--check", "--json")).rejects.toThrow("process.exit");
    const parsed = JSON.parse(output());
    expect(parsed.status).toBe("updates-available");
    expect(parsed.checked).toBe(1);
    expect(parsed.withChanges).toBe(1);
    expect(parsed.diffs).toBeArrayOfSize(1);
    expect(parsed.diffs[0].adrId).toBe("ARCH-001");
    expect(parsed.diffs[0].source).toBe("packs/typescript-strict");
    expect(parsed.diffs[0].summary).toBeString();
  });

  test("--check --json up to date → up-to-date JSON", async () => {
    setupSync("Same.", "Same.");
    await run("--check", "--json");
    const parsed = JSON.parse(output());
    expect(parsed.status).toBe("up-to-date");
    expect(parsed.withChanges).toBe(0);
  });

  // --yes mode (auto-apply)
  test("--yes auto-applies upstream changes and preserves local ID", async () => {
    scaffold();
    process.chdir(tempDir);
    const localPath = writeLocal("LOCAL-001-test.md", adr("LOCAL-001", "Old."));
    writeManifest(tempDir, [
      { source: "packs/typescript-strict", adrIds: ["LOCAL-001"] },
    ]);
    useMocks("packs/typescript-strict");
    scaffoldUpstream(upstreamDir, "packs/typescript-strict", [
      { filename: "UP-001-test.md", content: adr("UP-001", "New upstream.") },
    ]);
    await run("--yes");
    const updated = readFileSync(localPath, "utf-8");
    expect(updated).toContain("New upstream.");
    expect(updated).toContain("id: LOCAL-001");
    expect(updated).not.toContain("id: UP-001");
    expect(output()).toContain("Synced 1 ADR(s) from upstream");
  });

  test("--yes with no changes prints up-to-date message", async () => {
    setupSync("Same.", "Same.");
    await run("--yes");
    expect(output()).toContain("up to date");
  });

  test("--yes updates imports.json timestamps", async () => {
    scaffold();
    process.chdir(tempDir);
    writeLocal("ARCH-001-test.md", adr("ARCH-001", "Old."));
    writeManifest(tempDir, [
      {
        source: "packs/typescript-strict",
        importedAt: "2025-01-01T00:00:00.000Z",
        adrIds: ["ARCH-001"],
      },
    ]);
    useMocks("packs/typescript-strict");
    scaffoldUpstream(upstreamDir, "packs/typescript-strict", [
      { filename: "ARCH-001-test.md", content: adr("ARCH-001", "New.") },
    ]);
    await run("--yes");
    // Bun.write in saveImportsManifest is not awaited — yield to let it flush
    await Bun.sleep(50);
    const manifest = JSON.parse(
      readFileSync(join(tempDir, ".archgate", "imports.json"), "utf-8")
    );
    expect(manifest.imports[0].importedAt).not.toBe("2025-01-01T00:00:00.000Z");
  });

  // Error handling
  test("clone failure logs warning and continues with others", async () => {
    scaffold();
    process.chdir(tempDir);
    writeLocal("ARCH-001-test.md", adr("ARCH-001", "Content."));
    writeLocal("ARCH-002-test.md", adr("ARCH-002", "Content."));
    writeManifest(tempDir, [
      { source: "packs/broken-pack", adrIds: ["ARCH-001"] },
      { source: "packs/good-pack", adrIds: ["ARCH-002"] },
    ]);
    mockResolveSource.mockImplementation((input: string) => ({
      kind: "official" as const,
      repoUrl: input.includes("broken")
        ? "https://github.com/archgate/broken.git"
        : "https://github.com/archgate/awesome-adrs.git",
      subpath: input,
    }));
    mockShallowClone.mockImplementation((repoUrl: string) => {
      if (repoUrl.includes("broken")) {
        return Promise.reject(new Error("network timeout"));
      }
      return Promise.resolve(upstreamDir);
    });
    scaffoldUpstream(upstreamDir, "packs/good-pack", [
      { filename: "ARCH-002-test.md", content: adr("ARCH-002", "Content.") },
    ]);
    await run("--check");
    expect(warnings()).toContain("Failed to clone");
    expect(warnings()).toContain("network timeout");
  });

  test("resolveSource failure logs warning and continues", async () => {
    scaffold();
    process.chdir(tempDir);
    writeLocal("ARCH-001-test.md", adr("ARCH-001", "Content."));
    writeManifest(tempDir, [
      { source: "invalid-source", adrIds: ["ARCH-001"] },
    ]);
    mockResolveSource.mockImplementation(() => {
      throw new Error('Cannot resolve source "invalid-source"');
    });
    await run("--check");
    expect(warnings()).toContain("Cannot resolve source");
  });

  test("missing local ADR counts as error in JSON output", async () => {
    scaffold();
    process.chdir(tempDir);
    // No local file written for ARCH-001
    writeManifest(tempDir, [
      { source: "packs/typescript-strict", adrIds: ["ARCH-001"] },
    ]);
    useMocks("packs/typescript-strict");
    scaffoldUpstream(upstreamDir, "packs/typescript-strict", [
      { filename: "ARCH-001-test.md", content: adr("ARCH-001", "Upstream.") },
    ]);
    await run("--check", "--json");
    expect(JSON.parse(output()).errors).toBeGreaterThanOrEqual(1);
  });

  // Diff summary
  test("diff summary identifies changed sections", async () => {
    scaffold();
    process.chdir(tempDir);
    const local = adrWithSections("ARCH-001", "Same ctx.", "Old decision.");
    const upstream = adrWithSections("ARCH-001", "Same ctx.", "New decision.");
    writeLocal("ARCH-001-test.md", local);
    writeManifest(tempDir, [
      { source: "packs/typescript-strict", adrIds: ["ARCH-001"] },
    ]);
    useMocks("packs/typescript-strict");
    scaffoldUpstream(upstreamDir, "packs/typescript-strict", [
      { filename: "ARCH-001-test.md", content: upstream },
    ]);
    await expect(run("--check")).rejects.toThrow("process.exit");
    expect(output()).toContain("Decision");
  });

  // Non-interactive (no TTY, no --yes) skips updates
  test("non-interactive without --yes skips changes", async () => {
    const localPath = setupSync("Old.", "New.");
    await run();
    expect(readFileSync(localPath, "utf-8")).toContain("Old.");
    expect(output()).toContain("No ADRs were updated.");
  });

  // Clone caching
  test("deduplicates clone for same upstream repo across imports", async () => {
    scaffold();
    process.chdir(tempDir);
    const content = adr("ARCH-001", "Same.");
    writeLocal("ARCH-001-test.md", content);
    writeManifest(tempDir, [
      { source: "packs/pack-a", adrIds: ["ARCH-001"] },
      { source: "packs/pack-b", adrIds: ["ARCH-001"] },
    ]);
    mockResolveSource.mockImplementation((input: string) => ({
      kind: "official" as const,
      repoUrl: "https://github.com/archgate/awesome-adrs.git",
      subpath: input,
    }));
    mockShallowClone.mockResolvedValue(upstreamDir);
    scaffoldUpstream(upstreamDir, "packs/pack-a", [
      { filename: "ARCH-001-test.md", content },
    ]);
    scaffoldUpstream(upstreamDir, "packs/pack-b", [
      { filename: "ARCH-001-test.md", content },
    ]);
    await run("--check");
    expect(mockShallowClone).toHaveBeenCalledTimes(1);
  });
});
