// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerDomainCommand } from "../../../../src/commands/adr/domain/index";

function makeProgram(): Command {
  const adr = new Command("adr").exitOverride();
  registerDomainCommand(adr);
  return adr;
}

describe("adr domain remove", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-domain-remove-"));
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    originalCwd = process.cwd();
    process.chdir(tempDir);
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("deletes a custom entry", async () => {
    const p1 = makeProgram();
    await p1.parseAsync(["node", "adr", "domain", "add", "security", "SEC"]);

    logSpy.mockClear();
    const p2 = makeProgram();
    await p2.parseAsync(["node", "adr", "domain", "remove", "security"]);
    const out = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(out).toContain("Removed custom domain");
  });

  test("refuses built-in domains", async () => {
    const program = makeProgram();
    await expect(
      program.parseAsync(["node", "adr", "domain", "remove", "backend"])
    ).rejects.toThrow("process.exit");
  });

  test("missing entry reports not-registered", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "adr", "domain", "remove", "ghost"]);
    const out = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(out).toContain("not registered");
  });
});
