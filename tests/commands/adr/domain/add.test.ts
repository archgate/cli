import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerDomainCommand } from "../../../../src/commands/adr/domain/index";

function makeProgram(): Command {
  const adr = new Command("adr").exitOverride();
  registerDomainCommand(adr);
  return adr;
}

describe("adr domain add", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-domain-add-"));
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

  test("writes config and subsequent list shows the custom entry", async () => {
    const program = makeProgram();
    await program.parseAsync([
      "node",
      "adr",
      "domain",
      "add",
      "security",
      "SEC",
    ]);

    expect(existsSync(join(tempDir, ".archgate", "config.json"))).toBe(true);

    const out = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(out).toContain("security");

    logSpy.mockClear();
    const program2 = makeProgram();
    await program2.parseAsync(["node", "adr", "domain", "list", "--json"]);
    const raw = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    const parsed = JSON.parse(raw);
    const sec = (parsed as Array<{ domain: string; source: string }>).find(
      (e) => e.domain === "security"
    );
    expect(sec?.source).toBe("custom");
  });

  test("rejects built-in names", async () => {
    const program = makeProgram();
    await expect(
      program.parseAsync(["node", "adr", "domain", "add", "backend", "BE2"])
    ).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
