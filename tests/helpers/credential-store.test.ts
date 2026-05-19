// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
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
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* temp dir cleanup best-effort */
    }
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

    // This test depends on saveCredentials actually removing a legacy file,
    // which requires a working git credential helper. On Linux CI without a
    // configured helper, the credential flow does not behave the same way.
    test.skipIf(process.platform !== "win32")(
      "cleans up legacy metadata file on save",
      async () => {
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
      }
    );

    // This test relies on git credential approve + fill behavior which
    // differs based on the configured credential helper.
    test.skipIf(process.platform !== "win32")(
      "warns when verification after approve fails",
      async () => {
        // With no credential helper configured, approve succeeds (exit 0) but
        // fill returns nothing — triggers the verification warning path.
        const { saveCredentials } =
          await import("../../src/helpers/credential-store");

        const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
        try {
          await saveCredentials({
            token: "ag_beta_test",
            github_user: "testuser",
          });

          // The warning is printed because fill cannot verify the stored token.
          // Either the "approve failed" or "could not be verified" warning fires.
          expect(warnSpy).toHaveBeenCalled();
          const allArgs = warnSpy.mock.calls.flat().join(" ");
          const hasVerifyWarning =
            allArgs.includes("could not be verified") ||
            allArgs.includes("approve failed");
          expect(hasVerifyWarning).toBe(true);
        } finally {
          warnSpy.mockRestore();
        }
      }
    );
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

    test("completes without error when git credential reject runs", async () => {
      // clearCredentials calls gitCredentialFill first; with no helper
      // configured, fill returns null so reject is skipped — but legacy
      // cleanup still runs. This exercises the full clearCredentials path.
      const { clearCredentials } =
        await import("../../src/helpers/credential-store");

      mkdirSync(join(tempDir, ".archgate"), { recursive: true });
      const credPath = join(tempDir, ".archgate", "credentials");
      await Bun.write(credPath, "{}");

      await clearCredentials();
      expect(await Bun.file(credPath).exists()).toBe(false);
    });
  });

  describe("credential fill with store helper", () => {
    // This test depends on git credential store + fill round-tripping
    // correctly with env var overrides. The credential-store module's
    // gitCredentialEnv() spreads Bun.env at call time and the store helper
    // interaction differs across platforms. Skipped until we can reliably
    // isolate the credential helper in all CI environments.
    test.skip("round-trips credentials through a file-based credential helper", async () => {
      // Configure a simple store-based credential helper that persists
      // credentials to a file. This lets us exercise the approve→fill→reject
      // cycle end-to-end without touching the OS credential manager.
      const storePath = join(tempDir, "git-credentials");
      const gitConfig = join(tempDir, ".gitconfig");
      writeFileSync(
        gitConfig,
        `[credential]\n  helper = store --file=${storePath}\n`
      );
      // Point git at our custom config so the store helper is used
      Bun.env.GIT_CONFIG_GLOBAL = gitConfig;

      const { saveCredentials, loadCredentials, clearCredentials } =
        await import("../../src/helpers/credential-store");

      // Save should succeed and be verifiable
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        await saveCredentials({
          token: "ag_beta_roundtrip",
          github_user: "rounduser",
        });

        // With a working helper, verification succeeds — no warning about
        // "could not be verified".
        const verifyWarning = warnSpy.mock.calls
          .flat()
          .join(" ")
          .includes("could not be verified");
        expect(verifyWarning).toBe(false);
      } finally {
        warnSpy.mockRestore();
      }

      // Load should return the saved credentials
      const loaded = await loadCredentials();
      expect(loaded).not.toBeNull();
      expect(loaded!.token).toBe("ag_beta_roundtrip");
      expect(loaded!.github_user).toBe("rounduser");

      // Clear should remove them
      await clearCredentials();
      const afterClear = await loadCredentials();
      expect(afterClear).toBeNull();
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
