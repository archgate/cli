// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  spyOn,
  type Mock,
} from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerDomainCommand } from "../../../../src/commands/adr/domain/index";
import * as projectConfig from "../../../../src/helpers/project-config";

function makeProgram(): Command {
  const adr = new Command("adr").exitOverride();
  registerDomainCommand(adr);
  return adr;
}

describe("adr domain list", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: Mock<typeof console.log>;
  let exitSpy: Mock<typeof process.exit>;
  let errorSpy: Mock<typeof console.error>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-domain-list-"));
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

  test("shows built-in domains even with no config", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "adr", "domain", "list"]);
    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("backend");
    expect(out).toContain("default");
  });

  test("routes a config-read failure through the command error boundary", async () => {
    const entriesSpy = spyOn(
      projectConfig,
      "listDomainEntries"
    ).mockImplementation(() => {
      throw new Error("config.json is unreadable");
    });
    try {
      const program = makeProgram();
      expect(
        program.parseAsync(["node", "adr", "domain", "list"])
      ).rejects.toThrow("process.exit");

      // An unexpected failure is a bug, not user error → exit 2.
      expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(2);
      const errOut = errorSpy.mock.calls
        .map((c: unknown[]) => c.map(String).join(" "))
        .join("\n");
      expect(errOut).toContain("config.json is unreadable");
    } finally {
      entriesSpy.mockRestore();
    }
  });
});
