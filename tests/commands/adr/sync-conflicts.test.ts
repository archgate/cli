// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Conflict, cleanup and interactive-resolution paths of `archgate adr sync`.
 * Sibling of sync.test.ts, which is already at the `max-lines` budget.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  type Mock,
  spyOn,
  test,
} from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Module mocks — declared before imports that use them. mock.module is the
// sanctioned idiom for inquirer and node:readline only (ARCH-005).
// ---------------------------------------------------------------------------

interface SelectQuestion {
  type: string;
  name: string;
  message: string;
  choices: { name: string; value: string }[];
}

type SyncChoice = "keep" | "take" | "skip";

/** Answer returned by the next select prompt; set per test. */
let promptChoice: SyncChoice = "skip";

const mockInquirerPrompt = mock(
  async (_questions: SelectQuestion[]): Promise<{ choice: SyncChoice }> => ({
    choice: promptChoice,
  })
);

void mock.module("inquirer", () => ({
  default: { prompt: mockInquirerPrompt },
}));

// ---------------------------------------------------------------------------
// Imports under test — loaded AFTER the mocks are registered.
// ---------------------------------------------------------------------------

import { registerAdrSyncCommand } from "../../../src/commands/adr/sync";
import { withPromptFix } from "../../../src/helpers/prompt";
import * as registry from "../../../src/helpers/registry";
import { safeRmSync } from "../../test-utils";

const SyncJsonSchema = z.object({
  status: z.string(),
  checked: z.number().optional(),
  updated: z.number().optional(),
  withChanges: z.number().optional(),
  upToDate: z.number().optional(),
  errors: z.number().optional(),
});

const SUBPATH = "packs/typescript-strict";

/** A path segment with a NUL byte: absent to existsSync, fatal to rmSync. */
const NUL_PATH_SEGMENT = ["clone", "dir"].join(String.fromCodePoint(0));

/** Sample ADR markdown with frontmatter and a single Context section. */
function adr(id: string, body: string): string {
  return `---\nid: ${id}\ntitle: Test ADR ${id}\ndomain: architecture\nrules: false\n---\n\n## Context\n\n${body}\n`;
}

/** Write imports.json manifest. */
function writeManifest(
  dir: string,
  imports: { source: string; adrIds: string[] }[]
): void {
  const data = {
    imports: imports.map((i) => ({
      source: i.source,
      version: "0.1.0",
      importedAt: "2026-01-15T12:00:00.000Z",
      adrIds: i.adrIds,
    })),
  };
  writeFileSync(
    join(dir, ".archgate", "imports.json"),
    JSON.stringify(data, null, 2) + "\n"
  );
}

describe("adr sync conflicts and cleanup", () => {
  let tempDir: string;
  let upstreamDir: string;
  let originalCwd: string;
  let originalIsTTY: boolean | undefined;
  let logSpy: Mock<typeof console.log>;
  let warnSpy: Mock<typeof console.warn>;
  let errorSpy: Mock<typeof console.error>;
  let exitSpy: Mock<typeof process.exit>;
  let resolveSourceSpy: Mock<typeof registry.resolveSource>;
  let shallowCloneSpy: Mock<typeof registry.shallowClone>;

  // withPromptFix permanently rebinds console.log on Windows the first time it
  // runs (ARCH-019). Warming it up before any spy is installed keeps the
  // console.log spy below stable and its restore faithful.
  beforeAll(async () => {
    await withPromptFix(async () => true);
  });

  beforeEach(() => {
    promptChoice = "skip";
    mockInquirerPrompt.mockClear();
    tempDir = mkdtempSync(join(tmpdir(), "archgate-sync-conflict-"));
    upstreamDir = mkdtempSync(join(tmpdir(), "archgate-sync-conflict-up-"));
    originalCwd = process.cwd();
    originalIsTTY = process.stdin.isTTY;
    Bun.env.ARCHGATE_PROJECT_CEILING = tempDir;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    resolveSourceSpy = spyOn(registry, "resolveSource").mockReturnValue({
      kind: "official",
      repoUrl: "https://github.com/archgate/awesome-adrs.git",
      subpath: SUBPATH,
    });
    shallowCloneSpy = spyOn(registry, "shallowClone").mockResolvedValue(
      upstreamDir
    );
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    setTTY(originalIsTTY);
    delete Bun.env.ARCHGATE_PROJECT_CEILING;
    safeRmSync(tempDir);
    safeRmSync(upstreamDir);
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    resolveSourceSpy.mockRestore();
    shallowCloneSpy.mockRestore();
    mock.restore();
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function setTTY(value: boolean | undefined): void {
    Object.defineProperty(process.stdin, "isTTY", {
      value,
      configurable: true,
    });
  }

  function output(): string {
    return logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
  }

  function writeLocal(filename: string, content: string): string {
    const p = join(tempDir, ".archgate", "adrs", filename);
    writeFileSync(p, content);
    return p;
  }

  function writeUpstream(filename: string, content: string): void {
    const adrsDir = join(upstreamDir, SUBPATH, "adrs");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(join(adrsDir, filename), content);
  }

  async function run(...args: string[]): Promise<void> {
    const parent = new Command("adr").exitOverride();
    registerAdrSyncCommand(parent);
    await parent.parseAsync(["node", "adr", "sync", ...args]);
  }

  /** Local + upstream ARCH-001 differing in body, manifest wired to SUBPATH. */
  function setupChangedAdr(): string {
    const localPath = writeLocal("ARCH-001-test.md", adr("ARCH-001", "Old."));
    writeManifest(tempDir, [{ source: SUBPATH, adrIds: ["ARCH-001"] }]);
    writeUpstream("ARCH-001-test.md", adr("ARCH-001", "New upstream."));
    return localPath;
  }

  // -------------------------------------------------------------------------
  // Missing upstream material
  // -------------------------------------------------------------------------

  test("counts an error when the clone has no adrs/ directory", async () => {
    writeLocal("ARCH-001-test.md", adr("ARCH-001", "Local."));
    writeManifest(tempDir, [{ source: SUBPATH, adrIds: ["ARCH-001"] }]);
    // upstreamDir is cloned but never populated with <subpath>/adrs.

    await run("--check", "--json");

    const parsed = SyncJsonSchema.parse(JSON.parse(output()));
    expect(parsed.status).toBe("up-to-date");
    expect(parsed.checked).toBe(1);
    expect(parsed.errors).toBe(1);
    expect(shallowCloneSpy).toHaveBeenCalledTimes(1);
  });

  test("counts an error when upstream has fewer files than imported IDs", async () => {
    writeLocal("ARCH-001-test.md", adr("ARCH-001", "Local one."));
    writeLocal("ARCH-002-test.md", adr("ARCH-002", "Local two."));
    writeManifest(tempDir, [
      { source: SUBPATH, adrIds: ["ARCH-001", "ARCH-002"] },
    ]);
    writeUpstream("ARCH-001-test.md", adr("ARCH-001", "Local one."));

    await run("--check", "--json");

    const parsed = SyncJsonSchema.parse(JSON.parse(output()));
    expect(parsed.checked).toBe(2);
    expect(parsed.upToDate).toBe(1);
    expect(parsed.errors).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Diff summary
  // -------------------------------------------------------------------------

  test("diff summary names a section present only upstream", async () => {
    writeLocal("ARCH-001-test.md", adr("ARCH-001", "Shared."));
    writeManifest(tempDir, [{ source: SUBPATH, adrIds: ["ARCH-001"] }]);
    writeUpstream(
      "ARCH-001-test.md",
      `${adr("ARCH-001", "Shared.")}\n## Decision\n\nUpstream only.\n`
    );

    const running = run("--check");
    expect(running).rejects.toThrow("process.exit");
    await running.catch(() => {});

    expect(output()).toContain("Changed: Decision");
  });

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  test("a failing temp-dir removal does not abort the command", async () => {
    writeLocal("ARCH-001-test.md", adr("ARCH-001", "Same."));
    writeManifest(tempDir, [{ source: SUBPATH, adrIds: ["ARCH-001"] }]);
    // A clone path carrying a NUL byte reads as absent (existsSync returns
    // false) but makes rmSync throw, which is the cleanup failure under test.
    shallowCloneSpy.mockResolvedValue(join(upstreamDir, NUL_PATH_SEGMENT));

    await run("--check", "--json");

    const parsed = SyncJsonSchema.parse(JSON.parse(output()));
    expect(parsed.status).toBe("up-to-date");
    expect(parsed.errors).toBe(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Interactive keep / take / skip
  // -------------------------------------------------------------------------

  test("asks a three-way select question naming the ADR", async () => {
    setupChangedAdr();
    setTTY(true);

    await run();

    expect(mockInquirerPrompt).toHaveBeenCalledTimes(1);
    const question = mockInquirerPrompt.mock.calls[0][0][0];
    expect(question.name).toBe("choice");
    expect(question.message).toBe("ARCH-001: What would you like to do?");
    expect(question.choices.map((c) => c.value)).toEqual([
      "keep",
      "take",
      "skip",
    ]);
  });

  test("keep leaves the local ADR untouched", async () => {
    const localPath = setupChangedAdr();
    setTTY(true);
    promptChoice = "keep";

    await run();

    expect(readFileSync(localPath, "utf-8")).toContain("Old.");
    expect(output()).toContain("Kept local version of ARCH-001");
    expect(output()).toContain("No ADRs were updated.");
  });

  test("take rewrites the local ADR and preserves its ID", async () => {
    const localPath = setupChangedAdr();
    setTTY(true);
    promptChoice = "take";

    await run();

    const updated = readFileSync(localPath, "utf-8");
    expect(updated).toContain("New upstream.");
    expect(updated).toContain("id: ARCH-001");
    expect(output()).toContain("Synced 1 ADR(s) from upstream.");
  });

  test("skip leaves the local ADR untouched and reports no updates", async () => {
    const localPath = setupChangedAdr();
    setTTY(true);
    promptChoice = "skip";

    await run();

    expect(readFileSync(localPath, "utf-8")).toContain("Old.");
    expect(output()).toContain("No ADRs were updated.");
  });

  test("--yes bypasses the prompt even on a TTY", async () => {
    const localPath = setupChangedAdr();
    setTTY(true);

    await run("--yes");

    expect(mockInquirerPrompt).not.toHaveBeenCalled();
    expect(readFileSync(localPath, "utf-8")).toContain("New upstream.");
  });

  // -------------------------------------------------------------------------
  // Combined --json --yes
  // -------------------------------------------------------------------------

  test("--json --yes emits a synced summary and skips human output", async () => {
    const localPath = setupChangedAdr();
    setTTY(true);

    await run("--json", "--yes");

    expect(mockInquirerPrompt).not.toHaveBeenCalled();
    const parsed = SyncJsonSchema.parse(JSON.parse(output()));
    expect(parsed.status).toBe("synced");
    expect(parsed.checked).toBe(1);
    expect(parsed.updated).toBe(1);
    expect(parsed.withChanges).toBe(1);
    expect(parsed.errors).toBe(0);
    expect(readFileSync(localPath, "utf-8")).toContain("New upstream.");
  });
});
