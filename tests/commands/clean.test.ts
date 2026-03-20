import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerCleanCommand } from "../../src/commands/clean";

describe("registerCleanCommand", () => {
  test("registers 'clean' as a subcommand", () => {
    const program = new Command();
    registerCleanCommand(program);
    const sub = program.commands.find((c) => c.name() === "clean");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const program = new Command();
    registerCleanCommand(program);
    const sub = program.commands.find((c) => c.name() === "clean")!;
    expect(sub.description()).toBeTruthy();
  });
});

describe("clean action handler", () => {
  let tempDir: string;
  let fakeHome: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let logSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-clean-test-"));
    fakeHome = mkdtempSync(join(tmpdir(), "archgate-home-test-"));

    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;

    // Redirect internalPath() to our fake home
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;

    logSpy = spyOn(console, "log").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }

    rmSync(tempDir, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  function makeProgram(): Command {
    const program = new Command().exitOverride();
    registerCleanCommand(program);
    return program;
  }

  test("prints 'Nothing to clean.' when ~/.archgate/ does not exist", async () => {
    // fakeHome/.archgate does not exist
    const program = makeProgram();
    await program.parseAsync(["node", "test", "clean"]);

    const allOutput = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(allOutput).toContain("Nothing to clean.");
  });

  test("removes ~/.archgate/ directory when it exists", async () => {
    const archgateDir = join(fakeHome, ".archgate");
    mkdirSync(archgateDir, { recursive: true });
    writeFileSync(join(archgateDir, "cache.json"), "{}");

    const program = makeProgram();
    await program.parseAsync(["node", "test", "clean"]);

    expect(existsSync(archgateDir)).toBe(false);

    const allOutput = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(allOutput).toContain("cleaned up");
  });

  test("preserves bin/ directory when process.execPath starts with ~/.archgate/bin/", async () => {
    const archgateDir = join(fakeHome, ".archgate");
    const binDir = join(archgateDir, "bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, "archgate"), "binary");
    mkdirSync(join(archgateDir, "cache"), { recursive: true });
    writeFileSync(join(archgateDir, "cache", "data.json"), "{}");

    // Make process.execPath look like it starts from the bin directory
    const originalExecPath = process.execPath;
    Object.defineProperty(process, "execPath", {
      value: join(binDir, "archgate"),
      configurable: true,
    });

    try {
      const program = makeProgram();
      await program.parseAsync(["node", "test", "clean"]);

      // cache/ should be removed, bin/ should be preserved
      expect(existsSync(binDir)).toBe(true);
      expect(existsSync(join(archgateDir, "cache"))).toBe(false);

      const allOutput = logSpy.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .join("\n");
      expect(allOutput).toContain("bin/ preserved");
    } finally {
      Object.defineProperty(process, "execPath", {
        value: originalExecPath,
        configurable: true,
      });
    }
  });
});
