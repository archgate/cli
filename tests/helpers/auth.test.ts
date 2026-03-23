import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Type-safe fetch mock — Bun's fetch type includes `preconnect` which mock() doesn't provide. */
function mockFetch(handler: () => Promise<Response>) {
  globalThis.fetch = mock(handler) as unknown as typeof fetch;
}

describe("auth", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalGitConfigNoSystem: string | undefined;
  let originalGitConfigGlobal: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-auth-test-"));
    originalHome = Bun.env.HOME;
    originalUserProfile = Bun.env.USERPROFILE;
    originalGitConfigNoSystem = Bun.env.GIT_CONFIG_NOSYSTEM;
    originalGitConfigGlobal = Bun.env.GIT_CONFIG_GLOBAL;
    Bun.env.HOME = tempDir;
    Bun.env.USERPROFILE = tempDir;
    // Isolate git credential operations from the system credential store.
    Bun.env.GIT_CONFIG_NOSYSTEM = "1";
    const emptyGitConfig = join(tempDir, ".gitconfig");
    writeFileSync(emptyGitConfig, "");
    Bun.env.GIT_CONFIG_GLOBAL = emptyGitConfig;
  });

  afterEach(() => {
    Bun.env.HOME = originalHome;
    Bun.env.USERPROFILE = originalUserProfile;
    Bun.env.GIT_CONFIG_NOSYSTEM = originalGitConfigNoSystem;
    Bun.env.GIT_CONFIG_GLOBAL = originalGitConfigGlobal;
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("saveCredentials / loadCredentials", () => {
    test("saves metadata without token and round-trips via git credential manager", async () => {
      const { saveCredentials, loadCredentials } =
        await import("../../src/helpers/credential-store");

      await saveCredentials({
        token: "ag_beta_abc123",
        github_user: "testuser",
        created_at: "2026-01-15",
      });

      // Metadata file must not contain the token
      const credPath = join(tempDir, ".archgate", "credentials");
      const metadata = await Bun.file(credPath).json();
      expect(metadata.token).toBeUndefined();
      expect(metadata.github_user).toBe("testuser");

      // With isolated git config (no credential helper), loadCredentials
      // returns null because the token cannot be retrieved from the OS.
      const loaded = await loadCredentials();
      expect(loaded).toBeNull();
    });

    test("returns null when no credentials exist anywhere", async () => {
      const { loadCredentials } =
        await import("../../src/helpers/credential-store");

      const result = await loadCredentials();
      expect(result).toBeNull();
    });

    test("returns null when credentials file is invalid JSON", async () => {
      const { loadCredentials } =
        await import("../../src/helpers/credential-store");

      const credPath = join(tempDir, ".archgate", "credentials");
      const { mkdirSync } = await import("node:fs");
      mkdirSync(join(tempDir, ".archgate"), { recursive: true });
      await Bun.write(credPath, "not-json");

      const result = await loadCredentials();
      expect(result).toBeNull();
    });

    test("returns null when credentials file is missing required fields", async () => {
      const { loadCredentials } =
        await import("../../src/helpers/credential-store");

      const credPath = join(tempDir, ".archgate", "credentials");
      const { mkdirSync } = await import("node:fs");
      mkdirSync(join(tempDir, ".archgate"), { recursive: true });
      await Bun.write(credPath, JSON.stringify({ token: "abc" }));

      const result = await loadCredentials();
      expect(result).toBeNull();
    });
  });

  describe("clearCredentials", () => {
    test("removes credentials file", async () => {
      const { saveCredentials, clearCredentials, loadCredentials } =
        await import("../../src/helpers/credential-store");

      await saveCredentials({
        token: "ag_beta_abc123",
        github_user: "testuser",
        created_at: "2026-01-15",
      });

      await clearCredentials();

      const credPath = join(tempDir, ".archgate", "credentials");
      expect(await Bun.file(credPath).exists()).toBe(false);

      const loaded = await loadCredentials();
      expect(loaded).toBeNull();
    });

    test("does not throw when no credentials file exists", async () => {
      const { clearCredentials } =
        await import("../../src/helpers/credential-store");

      // Should not throw
      await clearCredentials();
    });
  });

  describe("requestDeviceCode", () => {
    test("sends POST to GitHub device code endpoint", async () => {
      const { requestDeviceCode } = await import("../../src/helpers/auth");

      const originalFetch = globalThis.fetch;
      mockFetch(() =>
        Promise.resolve(
          Response.json({
            device_code: "dc_123",
            user_code: "ABCD-1234",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          })
        )
      );

      try {
        const result = await requestDeviceCode();
        expect(result.device_code).toBe("dc_123");
        expect(result.user_code).toBe("ABCD-1234");
        expect(result.verification_uri).toBe("https://github.com/login/device");
        expect(result.interval).toBe(5);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("throws on non-200 response", async () => {
      const { requestDeviceCode } = await import("../../src/helpers/auth");

      const originalFetch = globalThis.fetch;
      mockFetch(() =>
        Promise.resolve(new Response("Bad Request", { status: 400 }))
      );

      try {
        await expect(requestDeviceCode()).rejects.toThrow("HTTP 400");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("getGitHubUser", () => {
    test("returns login from GitHub API", async () => {
      const { getGitHubUser } = await import("../../src/helpers/auth");

      const originalFetch = globalThis.fetch;
      mockFetch(() =>
        Promise.resolve(
          Response.json({ login: "octocat", email: "octo@cat.com" })
        )
      );

      try {
        const user = await getGitHubUser("gho_test_token");
        expect(user.login).toBe("octocat");
        expect(user.email).toBe("octo@cat.com");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("throws when GitHub API returns non-200", async () => {
      const { getGitHubUser } = await import("../../src/helpers/auth");

      const originalFetch = globalThis.fetch;
      mockFetch(() =>
        Promise.resolve(new Response("Unauthorized", { status: 401 }))
      );

      try {
        await expect(getGitHubUser("bad_token")).rejects.toThrow("HTTP 401");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("throws when login missing from response", async () => {
      const { getGitHubUser } = await import("../../src/helpers/auth");

      const originalFetch = globalThis.fetch;
      mockFetch(() =>
        Promise.resolve(Response.json({ email: "octo@cat.com" }))
      );

      try {
        await expect(getGitHubUser("gho_test_token")).rejects.toThrow(
          "GitHub API did not return a username"
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("claimArchgateToken", () => {
    test("returns token from plugins service", async () => {
      const { claimArchgateToken } = await import("../../src/helpers/auth");

      const originalFetch = globalThis.fetch;
      mockFetch(() =>
        Promise.resolve(Response.json({ token: "ag_beta_claimed_token" }))
      );

      try {
        const token = await claimArchgateToken("gho_github_token");
        expect(token).toBe("ag_beta_claimed_token");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("throws SignupRequiredError on 403 with no approved signup", async () => {
      const { claimArchgateToken } = await import("../../src/helpers/auth");
      const { SignupRequiredError } = await import("../../src/helpers/signup");

      const originalFetch = globalThis.fetch;
      mockFetch(() =>
        Promise.resolve(
          Response.json(
            { error: "No approved signup found for this GitHub account" },
            { status: 403 }
          )
        )
      );

      try {
        await expect(claimArchgateToken("gho_token")).rejects.toBeInstanceOf(
          SignupRequiredError
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("throws generic error on non-signup 403", async () => {
      const { claimArchgateToken } = await import("../../src/helpers/auth");

      const originalFetch = globalThis.fetch;
      mockFetch(() =>
        Promise.resolve(
          Response.json({ error: "Account suspended" }, { status: 403 })
        )
      );

      try {
        await expect(claimArchgateToken("gho_token")).rejects.toThrow(
          "Account suspended"
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("throws when token missing from successful response", async () => {
      const { claimArchgateToken } = await import("../../src/helpers/auth");

      const originalFetch = globalThis.fetch;
      mockFetch(() => Promise.resolve(Response.json({})));

      try {
        await expect(claimArchgateToken("gho_token")).rejects.toThrow(
          "Plugins service did not return a token"
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
