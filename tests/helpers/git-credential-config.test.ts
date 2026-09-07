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
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ensureGitCredentialHelper,
  helperCommand,
  inspectGitCredentialHelper,
  quoteForGitShell,
  registerGitCredentialHelper,
  unregisterGitCredentialHelper,
} from "../../src/helpers/git-credential-config";
import * as logMod from "../../src/helpers/log";
import { restoreEnv, safeRmSync } from "../test-utils";

const HELPER_KEY = "credential.https://plugins.archgate.dev.helper";

let tempDir: string;
let gitConfigPath: string;
let originalNoSystem: string | undefined;
let originalSystem: string | undefined;
let originalGlobal: string | undefined;

/**
 * Read the helper entries git has recorded, in order.
 *
 * Both piped streams are drained concurrently so neither can fill and block
 * git, and the exit code is checked before the output is trusted (ARCH-007).
 * Exit code 1 means the key is unset, which is an empty list rather than a
 * failure.
 *
 * @param scope - `global` reads the global file alone; `merged` reads every
 * scope in the order git consults them.
 */
async function configuredHelpers(
  scope: "global" | "merged" = "global"
): Promise<string[]> {
  const proc = Bun.spawn(
    [
      "git",
      "config",
      ...(scope === "global" ? ["--global"] : []),
      "--get-all",
      HELPER_KEY,
    ],
    { stdout: "pipe", stderr: "pipe", env: { ...Bun.env } }
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode === 1) return [];
  if (exitCode !== 0) {
    throw new Error(`git config exited ${exitCode}: ${stderr.trim()}`);
  }
  return stdout.split("\n").slice(0, -1);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "archgate-gitcred-test-"));
  originalNoSystem = Bun.env.GIT_CONFIG_NOSYSTEM;
  originalSystem = Bun.env.GIT_CONFIG_SYSTEM;
  originalGlobal = Bun.env.GIT_CONFIG_GLOBAL;
  gitConfigPath = join(tempDir, ".gitconfig");
  writeFileSync(gitConfigPath, "");
  Bun.env.GIT_CONFIG_NOSYSTEM = "1";
  Bun.env.GIT_CONFIG_GLOBAL = gitConfigPath;
});

afterEach(() => {
  mock.restore();
  restoreEnv("GIT_CONFIG_NOSYSTEM", originalNoSystem);
  restoreEnv("GIT_CONFIG_SYSTEM", originalSystem);
  restoreEnv("GIT_CONFIG_GLOBAL", originalGlobal);
  safeRmSync(tempDir);
});

// Git started by an editor rarely inherits the shell PATH, so the helper
// must name the executable by absolute path rather than as `archgate`.
describe("helperCommand", () => {
  test("invokes this executable by absolute path", () => {
    const command = helperCommand();

    expect(command.startsWith("!")).toBe(true);
    expect(command.endsWith(" credential")).toBe(true);
    expect(command).toContain(
      quoteForGitShell(process.execPath).replaceAll(/^'|'$/gu, "")
    );
  });
});

describe("quoteForGitShell", () => {
  test.each([
    ["a plain path", "/usr/local/bin/archgate", "/usr/local/bin/archgate"],
    [
      "a path with spaces",
      "/Users/Octo Cat/bin/archgate",
      "'/Users/Octo Cat/bin/archgate'",
    ],
    [
      "a Windows path",
      "C:\\Users\\octo\\.archgate\\bin\\archgate.exe",
      "C:/Users/octo/.archgate/bin/archgate.exe",
    ],
    ["an embedded quote", "/tmp/o'neil/archgate", "'/tmp/o'\\''neil/archgate'"],
  ])("handles %s", (_label, input, expected) => {
    expect(quoteForGitShell(input)).toBe(expected);
  });
});

describe("registerGitCredentialHelper", () => {
  test("records the helper for the plugins host", async () => {
    expect(await registerGitCredentialHelper()).toBe(true);

    expect(await configuredHelpers()).toEqual(["", helperCommand()]);
  });

  test("replaces an entry already in the global scope", async () => {
    writeFileSync(
      gitConfigPath,
      `[credential "https://plugins.archgate.dev"]\n\thelper = store\n`
    );

    await registerGitCredentialHelper();

    expect(await configuredHelpers()).toEqual(["", helperCommand()]);
  });

  // Git accumulates helpers across scopes and an empty entry discards the
  // list so far, so the system helper must sit before the reset for archgate
  // to be the only helper consulted for this host.
  test("writes the reset entry after helpers inherited from the system scope", async () => {
    const systemConfigPath = join(tempDir, "system.gitconfig");
    writeFileSync(
      systemConfigPath,
      `[credential "https://plugins.archgate.dev"]\n\thelper = store\n`
    );
    delete Bun.env.GIT_CONFIG_NOSYSTEM;
    Bun.env.GIT_CONFIG_SYSTEM = systemConfigPath;

    await registerGitCredentialHelper();

    expect(await configuredHelpers("merged")).toEqual([
      "store",
      "",
      helperCommand(),
    ]);
  });

  test("is idempotent across repeated logins", async () => {
    await registerGitCredentialHelper();
    await registerGitCredentialHelper();

    expect(await configuredHelpers()).toEqual(["", helperCommand()]);
  });

  test("scopes the entry to the plugins host alone", async () => {
    await registerGitCredentialHelper();

    const config = readFileSync(gitConfigPath, "utf8");
    expect(config).toContain('[credential "https://plugins.archgate.dev"]');
  });

  test("reports failure when git cannot write the config", async () => {
    // Pointing the config at a directory leaves git with nothing it can write.
    Bun.env.GIT_CONFIG_GLOBAL = tempDir;

    expect(await registerGitCredentialHelper()).toBe(false);
  });

  // Login must degrade to a warning, not an internal fault, without git.
  test("reports failure when git cannot be started", async () => {
    spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("spawn git ENOENT");
    });

    expect(await registerGitCredentialHelper()).toBe(false);
  });
});

// Downloads use the access token directly, so a failed git config write must
// not fail the login — only clones lose their non-interactive credentials.
describe("ensureGitCredentialHelper", () => {
  test("stays quiet when the helper is registered", async () => {
    const warnSpy = spyOn(logMod, "logWarn").mockImplementation(() => {});

    await ensureGitCredentialHelper();

    expect(warnSpy).not.toHaveBeenCalled();
    expect(await configuredHelpers()).toEqual(["", helperCommand()]);
  });

  test("warns instead of failing when git cannot write the config", async () => {
    Bun.env.GIT_CONFIG_GLOBAL = tempDir;
    const warnSpy = spyOn(logMod, "logWarn").mockImplementation(() => {});

    await ensureGitCredentialHelper();

    expect(warnSpy.mock.calls.flat().join(" ")).toContain(
      "Could not register archgate"
    );
  });
});

describe("unregisterGitCredentialHelper", () => {
  test("removes the entries login added", async () => {
    await registerGitCredentialHelper();

    expect(await unregisterGitCredentialHelper()).toBe(true);
    expect(await configuredHelpers()).toEqual([]);
  });

  // Exit code 5 means the key was already absent, which is the desired state.
  test("succeeds when no helper is configured", async () => {
    expect(await unregisterGitCredentialHelper()).toBe(true);
  });

  test("reports failure when git cannot be started", async () => {
    spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("spawn git ENOENT");
    });

    expect(await unregisterGitCredentialHelper()).toBe(false);
  });
});

describe("inspectGitCredentialHelper", () => {
  test("reports nothing registered on a clean config", async () => {
    expect(await inspectGitCredentialHelper()).toEqual({
      registered: false,
      current: false,
      resets_inherited: false,
    });
  });

  test("reports a healthy entry after login registers it", async () => {
    await registerGitCredentialHelper();

    expect(await inspectGitCredentialHelper()).toEqual({
      registered: true,
      current: true,
      resets_inherited: true,
    });
  });

  // The entry records an absolute path, so after an upgrade or a reinstall
  // elsewhere git runs a binary that is gone.
  test("flags an entry that names another archgate binary", async () => {
    writeFileSync(
      gitConfigPath,
      `[credential "https://plugins.archgate.dev"]\n\thelper = \n\thelper = !/old/archgate credential\n`
    );

    expect(await inspectGitCredentialHelper()).toEqual({
      registered: true,
      current: false,
      resets_inherited: true,
    });
  });

  test("flags a missing reset entry", async () => {
    writeFileSync(
      gitConfigPath,
      `[credential "https://plugins.archgate.dev"]\n\thelper = ${helperCommand()}\n`
    );

    expect(await inspectGitCredentialHelper()).toMatchObject({
      registered: true,
      current: true,
      resets_inherited: false,
    });
  });

  // A reset after archgate discards archgate too, so it does not count.
  test("flags a reset entry that comes after archgate", async () => {
    writeFileSync(
      gitConfigPath,
      `[credential "https://plugins.archgate.dev"]\n\thelper = ${helperCommand()}\n\thelper = \n`
    );

    expect(await inspectGitCredentialHelper()).toMatchObject({
      resets_inherited: false,
    });
  });

  test("reads the system scope git consults ahead of the global one", async () => {
    const systemConfigPath = join(tempDir, "system.gitconfig");
    writeFileSync(
      systemConfigPath,
      `[credential "https://plugins.archgate.dev"]\n\thelper = \n\thelper = !/old/archgate credential\n`
    );
    delete Bun.env.GIT_CONFIG_NOSYSTEM;
    Bun.env.GIT_CONFIG_SYSTEM = systemConfigPath;

    expect(await inspectGitCredentialHelper()).toMatchObject({
      registered: true,
      current: false,
    });
  });

  test("reports nothing registered when git cannot be started", async () => {
    spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("spawn git ENOENT");
    });

    expect(await inspectGitCredentialHelper()).toEqual({
      registered: false,
      current: false,
      resets_inherited: false,
    });
  });
});
