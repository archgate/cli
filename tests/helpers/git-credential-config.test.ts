// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  registerGitCredentialHelper,
  unregisterGitCredentialHelper,
} from "../../src/helpers/git-credential-config";
import { restoreEnv } from "../test-utils";

const HELPER_KEY = "credential.https://plugins.archgate.dev.helper";

let tempDir: string;
let gitConfigPath: string;
let originalNoSystem: string | undefined;
let originalGlobal: string | undefined;

/**
 * Read the helper entries git has recorded, in order.
 *
 * Both piped streams are drained concurrently so neither can fill and block
 * git, and the exit code is checked before the output is trusted (ARCH-007).
 * Exit code 1 means the key is unset, which is an empty list rather than a
 * failure.
 */
async function configuredHelpers(): Promise<string[]> {
  const proc = Bun.spawn(
    ["git", "config", "--global", "--get-all", HELPER_KEY],
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
  originalGlobal = Bun.env.GIT_CONFIG_GLOBAL;
  gitConfigPath = join(tempDir, ".gitconfig");
  writeFileSync(gitConfigPath, "");
  Bun.env.GIT_CONFIG_NOSYSTEM = "1";
  Bun.env.GIT_CONFIG_GLOBAL = gitConfigPath;
});

afterEach(() => {
  restoreEnv("GIT_CONFIG_NOSYSTEM", originalNoSystem);
  restoreEnv("GIT_CONFIG_GLOBAL", originalGlobal);
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* temp dir cleanup best-effort */
  }
});

describe("registerGitCredentialHelper", () => {
  test("records the helper for the plugins host", async () => {
    expect(await registerGitCredentialHelper()).toBe(true);

    expect(await configuredHelpers()).toEqual(["", "!archgate credential"]);
  });

  // The empty entry resets helpers inherited from a broader config scope, so
  // archgate is the only helper git consults for this host.
  test("writes the reset entry ahead of its own", async () => {
    writeFileSync(
      gitConfigPath,
      `[credential "https://plugins.archgate.dev"]\n\thelper = store\n`
    );

    await registerGitCredentialHelper();

    const helpers = await configuredHelpers();
    expect(helpers[0]).toBe("");
    expect(helpers).not.toContain("store");
  });

  test("is idempotent across repeated logins", async () => {
    await registerGitCredentialHelper();
    await registerGitCredentialHelper();

    expect(await configuredHelpers()).toEqual(["", "!archgate credential"]);
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
});
