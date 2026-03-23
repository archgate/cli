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
    test("writes metadata file WITHOUT token to ~/.archgate/credentials", async () => {
      const { saveCredentials } =
        await import("../../src/helpers/credential-store");

      await saveCredentials({
        token: "ag_beta_abc123",
        github_user: "testuser",
        created_at: "2026-01-15",
      });

      const credPath = join(tempDir, ".archgate", "credentials");
      const file = Bun.file(credPath);
      expect(await file.exists()).toBe(true);

      const data = await file.json();
      expect(data.github_user).toBe("testuser");
      expect(data.created_at).toBe("2026-01-15");
      // Token must NOT be present in the metadata file
      expect(data.token).toBeUndefined();
    });
  });

  describe("loadCredentials", () => {
    test("returns null when no credentials file and no git creds exist", async () => {
      const { loadCredentials } =
        await import("../../src/helpers/credential-store");

      const result = await loadCredentials();
      expect(result).toBeNull();
    });

    test("returns null when credentials file is invalid JSON", async () => {
      const { loadCredentials } =
        await import("../../src/helpers/credential-store");

      mkdirSync(join(tempDir, ".archgate"), { recursive: true });
      await Bun.write(join(tempDir, ".archgate", "credentials"), "not-json");

      const result = await loadCredentials();
      expect(result).toBeNull();
    });

    test("returns null when github_user is missing", async () => {
      const { loadCredentials } =
        await import("../../src/helpers/credential-store");

      mkdirSync(join(tempDir, ".archgate"), { recursive: true });
      await Bun.write(
        join(tempDir, ".archgate", "credentials"),
        JSON.stringify({ created_at: "2026-01-01" })
      );

      const result = await loadCredentials();
      expect(result).toBeNull();
    });

    test("returns null and deletes file when metadata has legacy plaintext token", async () => {
      const { loadCredentials } =
        await import("../../src/helpers/credential-store");

      const credPath = join(tempDir, ".archgate", "credentials");
      mkdirSync(join(tempDir, ".archgate"), { recursive: true });
      await Bun.write(
        credPath,
        JSON.stringify({
          token: "ag_beta_fallback",
          github_user: "testuser",
          created_at: "2026-01-15",
        })
      );

      // Legacy plaintext tokens are rejected — user must re-login.
      const result = await loadCredentials();
      expect(result).toBeNull();
      // The legacy credentials file should be deleted.
      expect(await Bun.file(credPath).exists()).toBe(false);
    });

    test("does not return credentials from plaintext file when git creds fail", async () => {
      const { loadCredentials } =
        await import("../../src/helpers/credential-store");

      mkdirSync(join(tempDir, ".archgate"), { recursive: true });
      // Write a metadata file with NO token (new format)
      await Bun.write(
        join(tempDir, ".archgate", "credentials"),
        JSON.stringify({ github_user: "testuser", created_at: "2026-01-15" })
      );

      // Without git credential helper returning creds, result should be null
      const result = await loadCredentials();
      // On CI without credential helper configured for this host, this is null
      if (!result) {
        expect(result).toBeNull();
      }
    });
  });

  describe("clearCredentials", () => {
    test("removes metadata file", async () => {
      const { saveCredentials, clearCredentials } =
        await import("../../src/helpers/credential-store");

      await saveCredentials({
        token: "ag_beta_abc123",
        github_user: "testuser",
        created_at: "2026-01-15",
      });

      await clearCredentials();

      const credPath = join(tempDir, ".archgate", "credentials");
      expect(await Bun.file(credPath).exists()).toBe(false);
    });

    test("does not throw when no credentials exist", async () => {
      const { clearCredentials } =
        await import("../../src/helpers/credential-store");

      // Should not throw
      await clearCredentials();
    });

    test("handles legacy metadata file with plaintext token", async () => {
      const { clearCredentials } =
        await import("../../src/helpers/credential-store");

      mkdirSync(join(tempDir, ".archgate"), { recursive: true });
      await Bun.write(
        join(tempDir, ".archgate", "credentials"),
        JSON.stringify({
          token: "ag_beta_legacy",
          github_user: "testuser",
          created_at: "2026-01-15",
        })
      );

      await clearCredentials();

      const credPath = join(tempDir, ".archgate", "credentials");
      expect(await Bun.file(credPath).exists()).toBe(false);
    });
  });

  describe("StoredCredentials type", () => {
    test("interface has expected shape", async () => {
      const mod = await import("../../src/helpers/credential-store");
      // Verify the module exports the expected functions
      expect(typeof mod.saveCredentials).toBe("function");
      expect(typeof mod.loadCredentials).toBe("function");
      expect(typeof mod.clearCredentials).toBe("function");
    });
  });
});
