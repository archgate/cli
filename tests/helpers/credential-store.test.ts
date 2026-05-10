// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("credential-store", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let originalGitConfigNoSystem: string | undefined;
  let originalGitConfigGlobal: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-credstore-test-"));
    originalHome = Bun.env.HOME;
    originalGitConfigNoSystem = Bun.env.GIT_CONFIG_NOSYSTEM;
    originalGitConfigGlobal = Bun.env.GIT_CONFIG_GLOBAL;
    Bun.env.HOME = tempDir;
    // Isolate git credential operations from the system credential store.
    Bun.env.GIT_CONFIG_NOSYSTEM = "1";
    const emptyGitConfig = join(tempDir, ".gitconfig");
    writeFileSync(emptyGitConfig, "");
    Bun.env.GIT_CONFIG_GLOBAL = emptyGitConfig;
  });

  afterEach(() => {
    Bun.env.HOME = originalHome;
    Bun.env.GIT_CONFIG_NOSYSTEM = originalGitConfigNoSystem;
    Bun.env.GIT_CONFIG_GLOBAL = originalGitConfigGlobal;
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("saveCredentials", () => {
    test("does not write any metadata file to disk", async () => {
      const { saveCredentials } =
        await import("../../src/helpers/credential-store");

      await saveCredentials({
        token: "ag_beta_abc123",
        github_user: "testuser",
      });

      // No credentials file should be written — everything is in git credential manager.
      const credPath = join(tempDir, ".archgate", "credentials");
      expect(await Bun.file(credPath).exists()).toBe(false);
    });

    test("cleans up legacy metadata file on save", async () => {
      const { saveCredentials } =
        await import("../../src/helpers/credential-store");

      // Create a legacy metadata file
      mkdirSync(join(tempDir, ".archgate"), { recursive: true });
      const credPath = join(tempDir, ".archgate", "credentials");
      await Bun.write(
        credPath,
        JSON.stringify({ github_user: "old", created_at: "2025-01-01" })
      );

      await saveCredentials({
        token: "ag_beta_abc123",
        github_user: "testuser",
      });

      // Legacy file should be removed.
      expect(await Bun.file(credPath).exists()).toBe(false);
    });
  });

  describe("loadCredentials", () => {
    test("returns null when no credentials exist anywhere", async () => {
      const { loadCredentials } =
        await import("../../src/helpers/credential-store");

      const result = await loadCredentials();
      expect(result).toBeNull();
    });

    test("returns null and deletes legacy metadata file", async () => {
      const { loadCredentials } =
        await import("../../src/helpers/credential-store");

      const credPath = join(tempDir, ".archgate", "credentials");
      mkdirSync(join(tempDir, ".archgate"), { recursive: true });
      await Bun.write(
        credPath,
        JSON.stringify({
          token: "ag_beta_legacy",
          github_user: "testuser",
          created_at: "2026-01-15",
        })
      );

      // Legacy file triggers deletion and returns null (re-login required).
      const result = await loadCredentials();
      expect(result).toBeNull();
      expect(await Bun.file(credPath).exists()).toBe(false);
    });

    test("returns null when no git creds and no legacy file", async () => {
      const { loadCredentials } =
        await import("../../src/helpers/credential-store");

      // With isolated git config (no credential helper), returns null.
      const result = await loadCredentials();
      expect(result).toBeNull();
    });
  });

  describe("clearCredentials", () => {
    test("does not throw when no credentials exist", async () => {
      const { clearCredentials } =
        await import("../../src/helpers/credential-store");

      // Should not throw
      await clearCredentials();
    });

    test("cleans up legacy metadata file", async () => {
      const { clearCredentials } =
        await import("../../src/helpers/credential-store");

      mkdirSync(join(tempDir, ".archgate"), { recursive: true });
      const credPath = join(tempDir, ".archgate", "credentials");
      await Bun.write(
        credPath,
        JSON.stringify({ github_user: "testuser", created_at: "2026-01-15" })
      );

      await clearCredentials();

      expect(await Bun.file(credPath).exists()).toBe(false);
    });
  });

  describe("StoredCredentials type", () => {
    test("interface has expected shape", async () => {
      const mod = await import("../../src/helpers/credential-store");
      expect(typeof mod.saveCredentials).toBe("function");
      expect(typeof mod.loadCredentials).toBe("function");
      expect(typeof mod.clearCredentials).toBe("function");
    });
  });
});
