// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerAdrSyncCommand } from "../../../src/commands/adr/sync";
import { safeRmSync } from "../../test-utils";

describe("adr sync command", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-sync-"));
    originalCwd = process.cwd();
    Bun.env.ARCHGATE_PROJECT_CEILING = tempDir;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    delete Bun.env.ARCHGATE_PROJECT_CEILING;
    safeRmSync(tempDir);
    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  function scaffoldProject(): void {
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    mkdirSync(join(tempDir, ".archgate", "lint"), { recursive: true });
  }

  test("registers sync command with correct options", () => {
    const parent = new Command("adr").exitOverride();
    registerAdrSyncCommand(parent);

    const sync = parent.commands.find((c) => c.name() === "sync");
    expect(sync).toBeDefined();
    expect(sync!.description()).toBe(
      "Check for upstream updates to imported ADRs"
    );

    // Check options exist
    const optionNames = sync!.options.map((o) => o.long);
    expect(optionNames).toContain("--check");
    expect(optionNames).toContain("--yes");
    expect(optionNames).toContain("--json");
  });

  test("prints empty message when no imports exist", async () => {
    scaffoldProject();
    process.chdir(tempDir);

    const parent = new Command("adr").exitOverride();
    registerAdrSyncCommand(parent);

    await parent.parseAsync(["node", "adr", "sync"]);

    const allOutput = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(allOutput).toContain("No imported ADRs found.");
  });

  test("prints empty message in JSON mode when no imports exist", async () => {
    scaffoldProject();
    process.chdir(tempDir);

    const parent = new Command("adr").exitOverride();
    registerAdrSyncCommand(parent);

    await parent.parseAsync(["node", "adr", "sync", "--json"]);

    const allOutput = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    const parsed = JSON.parse(allOutput);
    expect(parsed.status).toBe("empty");
  });

  test("exits with error when .archgate/ directory is missing", async () => {
    process.chdir(tempDir);

    const parent = new Command("adr").exitOverride();
    registerAdrSyncCommand(parent);

    await expect(parent.parseAsync(["node", "adr", "sync"])).rejects.toThrow(
      "process.exit"
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("filters by source when source args provided", async () => {
    scaffoldProject();
    process.chdir(tempDir);

    // Write an imports manifest with entries
    writeFileSync(
      join(tempDir, ".archgate", "imports.json"),
      JSON.stringify(
        {
          imports: [
            {
              source: "packs/typescript-strict",
              version: "0.1.0",
              importedAt: "2026-01-15T12:00:00.000Z",
              adrIds: ["ARCH-001"],
            },
          ],
        },
        null,
        2
      ) + "\n"
    );

    const parent = new Command("adr").exitOverride();
    registerAdrSyncCommand(parent);

    // Filter by a non-matching source
    await parent.parseAsync(["node", "adr", "sync", "packs/nonexistent"]);

    const allOutput = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(allOutput).toContain("No imports match the given source filter(s).");
  });
});
