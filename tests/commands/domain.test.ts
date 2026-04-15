import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerDomainCommand } from "../../src/commands/domain/index";

function makeProgram(): Command {
  const root = new Command("archgate").exitOverride();
  registerDomainCommand(root);
  return root;
}

describe("domain command", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-domain-cmd-"));
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

  test("domain list shows built-in domains even with no config", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "archgate", "domain", "list"]);
    const out = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(out).toContain("backend");
    expect(out).toContain("default");
  });

  test("domain add writes config and subsequent list shows custom entry", async () => {
    const program = makeProgram();
    await program.parseAsync([
      "node",
      "archgate",
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
    await program2.parseAsync(["node", "archgate", "domain", "list", "--json"]);
    const raw = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    const parsed = JSON.parse(raw);
    const sec = (parsed as Array<{ domain: string; source: string }>).find(
      (e) => e.domain === "security"
    );
    expect(sec?.source).toBe("custom");
  });

  test("domain add rejects built-in names", async () => {
    const program = makeProgram();
    await expect(
      program.parseAsync([
        "node",
        "archgate",
        "domain",
        "add",
        "backend",
        "BE2",
      ])
    ).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("domain remove deletes a custom entry", async () => {
    const p1 = makeProgram();
    await p1.parseAsync([
      "node",
      "archgate",
      "domain",
      "add",
      "security",
      "SEC",
    ]);

    logSpy.mockClear();
    const p2 = makeProgram();
    await p2.parseAsync(["node", "archgate", "domain", "remove", "security"]);
    const out = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(out).toContain("Removed custom domain");
  });

  test("domain remove refuses built-in domains", async () => {
    const program = makeProgram();
    await expect(
      program.parseAsync(["node", "archgate", "domain", "remove", "backend"])
    ).rejects.toThrow("process.exit");
  });

  test("domain remove on missing entry reports not-registered", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "archgate", "domain", "remove", "ghost"]);
    const out = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(out).toContain("not registered");
  });
});
