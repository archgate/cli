// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { restoreEnv } from "../test-utils";

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
    // `Bun.env.X = undefined` assigns the STRING "undefined" and leaves the key
    // present — it does not unset. Since HOME and GIT_CONFIG_GLOBAL are normally
    // unset on Windows, a plain restore leaked HOME="undefined" into the shared
    // process env, and every later test that spawned a subprocess inherited it.
    // Bun.env is process-global and test files share one process, so this must
    // delete when the original was absent.
    restoreEnv("HOME", originalHome);
    restoreEnv("USERPROFILE", originalUserProfile);
    restoreEnv("GIT_CONFIG_NOSYSTEM", originalGitConfigNoSystem);
    restoreEnv("GIT_CONFIG_GLOBAL", originalGitConfigGlobal);
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("saveCredentials / loadCredentials", () => {
    test("does not write any file to disk", async () => {
      const { saveCredentials } =
        await import("../../src/helpers/credential-store");

      await saveCredentials({
        token: "ag_beta_abc123",
        github_user: "testuser",
      });

      // No credentials file should exist — everything is in git credential manager.
      const credPath = join(tempDir, ".archgate", "credentials");
      expect(await Bun.file(credPath).exists()).toBe(false);
    });

    test("returns null when no credentials exist anywhere", async () => {
      const { loadCredentials } =
        await import("../../src/helpers/credential-store");

      const result = await loadCredentials();
      expect(result).toBeNull();
    });

    test("returns null and deletes legacy credentials file", async () => {
      const { loadCredentials } =
        await import("../../src/helpers/credential-store");

      const credPath = join(tempDir, ".archgate", "credentials");
      const { mkdirSync } = await import("node:fs");
      mkdirSync(join(tempDir, ".archgate"), { recursive: true });
      await Bun.write(
        credPath,
        JSON.stringify({ token: "abc", github_user: "old" })
      );

      const result = await loadCredentials();
      expect(result).toBeNull();
      expect(await Bun.file(credPath).exists()).toBe(false);
    });
  });

  describe("clearCredentials", () => {
    test("clears git creds and removes legacy file", async () => {
      const { clearCredentials } =
        await import("../../src/helpers/credential-store");

      // Create a legacy file
      const { mkdirSync } = await import("node:fs");
      mkdirSync(join(tempDir, ".archgate"), { recursive: true });
      const credPath = join(tempDir, ".archgate", "credentials");
      await Bun.write(credPath, "{}");

      await clearCredentials();

      expect(await Bun.file(credPath).exists()).toBe(false);
    });

    test("does not throw when no credentials exist", async () => {
      const { clearCredentials } =
        await import("../../src/helpers/credential-store");

      await expect(clearCredentials()).resolves.toBeUndefined();
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

  describe("pollForAccessToken", () => {
    test("returns token after authorization_pending then success", async () => {
      const { pollForAccessToken } = await import("../../src/helpers/auth");

      const originalFetch = globalThis.fetch;
      const originalSleep = Bun.sleep;
      Bun.sleep = mock(() => Promise.resolve()) as unknown as typeof Bun.sleep;

      let callCount = 0;
      globalThis.fetch = mock(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            Response.json({ error: "authorization_pending" })
          );
        }
        return Promise.resolve(
          Response.json({
            access_token: "gho_polled_token",
            token_type: "bearer",
            scope: "read:user",
          })
        );
      }) as unknown as typeof fetch;

      try {
        const token = await pollForAccessToken("dc_abc", 0, 60);
        expect(token).toBe("gho_polled_token");
        expect(callCount).toBe(2);
      } finally {
        globalThis.fetch = originalFetch;
        Bun.sleep = originalSleep;
      }
    });

    test("handles slow_down by increasing poll interval", async () => {
      const { pollForAccessToken } = await import("../../src/helpers/auth");

      const originalFetch = globalThis.fetch;
      const originalSleep = Bun.sleep;
      const sleepArgs: number[] = [];
      Bun.sleep = mock((ms: number) => {
        sleepArgs.push(ms);
        return Promise.resolve();
      }) as unknown as typeof Bun.sleep;

      let callCount = 0;
      globalThis.fetch = mock(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(Response.json({ error: "slow_down" }));
        }
        return Promise.resolve(
          Response.json({
            access_token: "gho_after_slow_down",
            token_type: "bearer",
            scope: "read:user",
          })
        );
      }) as unknown as typeof fetch;

      try {
        const token = await pollForAccessToken("dc_abc", 0, 60);
        expect(token).toBe("gho_after_slow_down");
        // After slow_down, interval increases by 5; second sleep should be 5*1000
        expect(sleepArgs[1]).toBe(5 * 1000);
      } finally {
        globalThis.fetch = originalFetch;
        Bun.sleep = originalSleep;
      }
    });

    test("throws on expired_token", async () => {
      const { pollForAccessToken } = await import("../../src/helpers/auth");

      const originalFetch = globalThis.fetch;
      const originalSleep = Bun.sleep;
      Bun.sleep = mock(() => Promise.resolve()) as unknown as typeof Bun.sleep;

      mockFetch(() =>
        Promise.resolve(
          Response.json({
            error: "expired_token",
            error_description: "The device code has expired.",
          })
        )
      );

      try {
        await expect(pollForAccessToken("dc_abc", 0, 60)).rejects.toThrow(
          "The device code has expired."
        );
      } finally {
        globalThis.fetch = originalFetch;
        Bun.sleep = originalSleep;
      }
    });

    test("throws on access_denied", async () => {
      const { pollForAccessToken } = await import("../../src/helpers/auth");

      const originalFetch = globalThis.fetch;
      const originalSleep = Bun.sleep;
      Bun.sleep = mock(() => Promise.resolve()) as unknown as typeof Bun.sleep;

      mockFetch(() =>
        Promise.resolve(
          Response.json({
            error: "access_denied",
            error_description: "The user denied your request.",
          })
        )
      );

      try {
        await expect(pollForAccessToken("dc_abc", 0, 60)).rejects.toThrow(
          "The user denied your request."
        );
      } finally {
        globalThis.fetch = originalFetch;
        Bun.sleep = originalSleep;
      }
    });

    test("throws when deadline expires before authorization", async () => {
      const { pollForAccessToken } = await import("../../src/helpers/auth");

      const originalFetch = globalThis.fetch;
      const originalSleep = Bun.sleep;
      Bun.sleep = mock(() => Promise.resolve()) as unknown as typeof Bun.sleep;

      mockFetch(() =>
        Promise.resolve(Response.json({ error: "authorization_pending" }))
      );

      try {
        await expect(pollForAccessToken("dc_abc", 0, 0)).rejects.toThrow(
          "Device code expired. Please try again."
        );
      } finally {
        globalThis.fetch = originalFetch;
        Bun.sleep = originalSleep;
      }
    });
  });
});
