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

describe("adr domain list", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;

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
    const out = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(out).toContain("backend");
    expect(out).toContain("default");
  });
});
