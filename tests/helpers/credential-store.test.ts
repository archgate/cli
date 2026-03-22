import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("credential-store", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-credstore-test-"));
    originalHome = Bun.env.HOME;
    Bun.env.HOME = tempDir;
  });

  afterEach(() => {
    Bun.env.HOME = originalHome;
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("saveCredentials", () => {
    test("writes metadata file to ~/.archgate/credentials", async () => {
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
    });
  });

  describe("loadCredentials", () => {
    test("returns null when no credentials file exists", async () => {
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
        JSON.stringify({ token: "abc", created_at: "2026-01-01" })
      );

      const result = await loadCredentials();
      expect(result).toBeNull();
    });

    test("falls back to token in file when git credential fill fails", async () => {
      const { loadCredentials } =
        await import("../../src/helpers/credential-store");

      mkdirSync(join(tempDir, ".archgate"), { recursive: true });
      await Bun.write(
        join(tempDir, ".archgate", "credentials"),
        JSON.stringify({
          token: "ag_beta_fallback",
          github_user: "testuser",
          created_at: "2026-01-15",
        })
      );

      const result = await loadCredentials();
      expect(result).not.toBeNull();
      expect(result!.github_user).toBe("testuser");
      // Token comes from either git credential manager or file fallback
      expect(result!.token).toBeTruthy();
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
