// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  saveTokenSet,
  loadCredentials,
  loadTokenSet,
  resolveAccessToken,
  clearCredentials,
} from "../../src/helpers/credential-store";
import * as logtoMod from "../../src/helpers/logto-auth";
import { UserError } from "../../src/helpers/user-error";
import { rejectionMessage, restoreEnv } from "../test-utils";

/**
 * A `Bun.spawn` stand-in that answers `git credential fill` with one record.
 *
 * @param username - Value returned in the `username` field.
 * @param password - Value returned in the `password` field.
 */
function gitCredentialStub(
  username: string,
  password: string
): ReturnType<typeof Bun.spawn> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return {
    stdout: new Response(`username=${username}\npassword=${password}\n`).body,
    exited: Promise.resolve(0),
    kill: () => {
      // Nothing to kill: the stub has already settled.
    },
  } as unknown as ReturnType<typeof Bun.spawn>;
}

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
    // restoreEnv deletes when the captured value was unset, which matters
    // because HOME and GIT_CONFIG_GLOBAL are normally unset on Windows: a
    // bare assignment stores the string "undefined" and Bun.env is
    // process-global, so it reaches every later test file and subprocess.
    restoreEnv("HOME", originalHome);
    restoreEnv("GIT_CONFIG_NOSYSTEM", originalGitConfigNoSystem);
    restoreEnv("GIT_CONFIG_GLOBAL", originalGitConfigGlobal);
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* temp dir cleanup best-effort */
    }
  });

  describe("saveTokenSet", () => {
    test("does not write any metadata file to disk", async () => {
      await saveTokenSet("testuser", {
        accessToken: "ey.access",
        refreshToken: "refresh-abc",
        expiresAt: Date.now() + 3_600_000,
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
        mkdirSync(join(tempDir, ".archgate"), { recursive: true });
        const credPath = join(tempDir, ".archgate", "credentials");
        await Bun.write(
          credPath,
          JSON.stringify({ github_user: "old", created_at: "2025-01-01" })
        );

        await saveTokenSet("testuser", {
          accessToken: "ag_beta_abc123",
          refreshToken: "refresh-abc",
          expiresAt: Date.now() + 3_600_000,
        });

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
        const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
        try {
          await saveTokenSet("testuser", {
            accessToken: "ag_beta_test",
            refreshToken: "refresh-abc",
            expiresAt: Date.now() + 3_600_000,
          });

          // The warning is printed because fill cannot verify the stored token.
          // Either the "approve failed" or "could not be verified" warning fires.
          expect(warnSpy).toHaveBeenCalled();
          const allArgs = warnSpy.mock.calls.flat().join(" ");
          expect(allArgs).toMatch(/could not be verified|approve failed/u);
        } finally {
          warnSpy.mockRestore();
        }
      }
    );
  });

  describe("loadCredentials", () => {
    test("returns null when no credentials exist anywhere", async () => {
      const result = await loadCredentials();
      expect(result).toBeNull();
    });

    test("returns null and deletes legacy metadata file", async () => {
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
      // With isolated git config (no credential helper), returns null.
      const result = await loadCredentials();
      expect(result).toBeNull();
    });
  });

  describe("clearCredentials", () => {
    test("does not throw when no credentials exist", async () => {
      expect(clearCredentials()).resolves.toBeUndefined();
    });

    test("cleans up legacy metadata file", async () => {
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

      mkdirSync(join(tempDir, ".archgate"), { recursive: true });
      const credPath = join(tempDir, ".archgate", "credentials");
      await Bun.write(credPath, "{}");

      await clearCredentials();
      expect(await Bun.file(credPath).exists()).toBe(false);
    });
  });

  describe("credential fill with store helper", () => {
    test("round-trips credentials through a file-based credential helper", async () => {
      // A store-based helper persists to a plain file, exercising the
      // approve→fill→reject cycle end-to-end without touching the OS
      // credential manager. Backslashes are escape characters in a git config
      // value, so the Windows temp path is written with forward slashes.
      const storePath = join(tempDir, "git-credentials").replaceAll("\\", "/");
      const gitConfig = join(tempDir, ".gitconfig");
      writeFileSync(
        gitConfig,
        `[credential]\n\thelper = store --file=${storePath}\n`
      );
      Bun.env.GIT_CONFIG_GLOBAL = gitConfig;

      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        await saveTokenSet("rounduser", {
          accessToken: "ag_beta_roundtrip",
          refreshToken: "refresh-abc",
          expiresAt: Date.now() + 3_600_000,
        });

        // With a working helper, verification succeeds — no warning about
        // "could not be verified".
        const allArgsJoined = warnSpy.mock.calls.flat().join(" ");
        expect(allArgsJoined).not.toContain("could not be verified");
      } finally {
        warnSpy.mockRestore();
      }

      const loaded = await loadCredentials();
      expect(loaded).toEqual({
        token: "ag_beta_roundtrip",
        github_user: "rounduser",
      });

      await clearCredentials();
      expect(await loadCredentials()).toBeNull();
    });
  });

  describe("git credential subprocess failures", () => {
    /**
     * Fake Subprocess whose stdout never closes and whose exit never settles,
     * so `gitCredentialFill` loses its race against the 3s timeout.
     */
    function neverSettlingProc(
      onKill: () => void
    ): ReturnType<typeof Bun.spawn> {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return {
        stdout: new ReadableStream<Uint8Array>({ start() {} }),
        stderr: new ReadableStream<Uint8Array>({ start() {} }),
        exited: new Promise<number>(() => {}),
        kill: onKill,
      } as unknown as ReturnType<typeof Bun.spawn>;
    }

    test("kills the fill subprocess and returns null when it exceeds the timeout", async () => {
      let killed = false;
      const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() =>
        neverSettlingProc(() => {
          killed = true;
        })
      );
      try {
        expect(await loadCredentials()).toBeNull();
        expect(killed).toBe(true);
      } finally {
        spawnSpy.mockRestore();
      }
    });

    test("returns null when the fill subprocess cannot be spawned", async () => {
      const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
        throw new Error("spawn unavailable");
      });
      try {
        expect(await loadCredentials()).toBeNull();
      } finally {
        spawnSpy.mockRestore();
      }
    });

    test("warns when git credential approve exits non-zero", async () => {
      const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return {
          stdout: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.close();
            },
          }),
          stderr: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.close();
            },
          }),
          exited: Promise.resolve(1),
          kill: () => {},
        } as unknown as ReturnType<typeof Bun.spawn>;
      });
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        await saveTokenSet("u", {
          accessToken: "ag_beta_x",
          refreshToken: "refresh-abc",
          expiresAt: Date.now() + 3_600_000,
        });

        expect(warnSpy.mock.calls.flat().join(" ")).toContain(
          "git credential approve failed."
        );
      } finally {
        warnSpy.mockRestore();
        spawnSpy.mockRestore();
      }
    });
  });

  describe("public surface", () => {
    test("exposes the store, load and clear entry points", () => {
      expect(typeof saveTokenSet).toBe("function");
      expect(typeof loadTokenSet).toBe("function");
      expect(typeof loadCredentials).toBe("function");
      expect(typeof clearCredentials).toBe("function");
    });
  });

  describe("loadTokenSet", () => {
    test("returns null when the stored blob is not a token set", async () => {
      const fillSpy = spyOn(Bun, "spawn").mockImplementation(() =>
        gitCredentialStub("archgate", "not-json")
      );
      try {
        expect(await loadTokenSet()).toBeNull();
      } finally {
        fillSpy.mockRestore();
      }
    });

    test("returns null when the JSON is missing token fields", async () => {
      const fillSpy = spyOn(Bun, "spawn").mockImplementation(() =>
        gitCredentialStub("archgate", JSON.stringify({ a: 1 }))
      );
      try {
        expect(await loadTokenSet()).toBeNull();
      } finally {
        fillSpy.mockRestore();
      }
    });

    test("returns the stored token set and its user", async () => {
      const tokens = {
        accessToken: "ey.access",
        refreshToken: "refresh-abc",
        expiresAt: Date.now() + 3_600_000,
      };
      const fillSpy = spyOn(Bun, "spawn").mockImplementation(() =>
        gitCredentialStub("octocat", JSON.stringify(tokens))
      );
      try {
        expect(await loadTokenSet()).toEqual({ user: "octocat", tokens });
      } finally {
        fillSpy.mockRestore();
      }
    });
  });

  describe("resolveAccessToken", () => {
    test("returns the cached token while it is still valid", async () => {
      const tokens = {
        accessToken: "ey.valid",
        refreshToken: "refresh-abc",
        expiresAt: Date.now() + 3_600_000,
      };
      const fillSpy = spyOn(Bun, "spawn").mockImplementation(() =>
        gitCredentialStub("octocat", JSON.stringify(tokens))
      );
      const refreshSpy = spyOn(logtoMod, "refreshAccessToken");
      try {
        expect(await resolveAccessToken()).toEqual({
          token: "ey.valid",
          github_user: "octocat",
        });
        expect(refreshSpy).not.toHaveBeenCalled();
      } finally {
        refreshSpy.mockRestore();
        fillSpy.mockRestore();
      }
    });

    test("renews an expired token and hands back the new one", async () => {
      const stale = {
        accessToken: "ey.stale",
        refreshToken: "refresh-old",
        expiresAt: Date.now() - 1_000,
      };
      const fillSpy = spyOn(Bun, "spawn").mockImplementation(() =>
        gitCredentialStub("octocat", JSON.stringify(stale))
      );
      const refreshSpy = spyOn(
        logtoMod,
        "refreshAccessToken"
      ).mockResolvedValue({
        accessToken: "ey.fresh",
        refreshToken: "refresh-new",
        expiresAt: Date.now() + 3_600_000,
      });
      try {
        expect(await resolveAccessToken()).toEqual({
          token: "ey.fresh",
          github_user: "octocat",
        });
        expect(refreshSpy).toHaveBeenCalledWith("refresh-old");
      } finally {
        refreshSpy.mockRestore();
        fillSpy.mockRestore();
      }
    });
  });

  // The regression the review caught: a rejected refresh token is a signed-out
  // state, so loadCredentials must keep its null contract and still reach the
  // legacy lookup rather than throwing at every caller.
  describe("loadCredentials with an unrenewable session", () => {
    test("falls through to a legacy token", async () => {
      const stale = {
        accessToken: "ey.stale",
        refreshToken: "refresh-old",
        expiresAt: Date.now() - 1_000,
      };
      let call = 0;
      const fillSpy = spyOn(Bun, "spawn").mockImplementation(() => {
        call += 1;
        // First fill answers for AUTH_HOST, the second for PLUGINS_HOST.
        return call === 1
          ? gitCredentialStub("octocat", JSON.stringify(stale))
          : gitCredentialStub("octocat", "ag_beta_legacy");
      });
      const refreshSpy = spyOn(
        logtoMod,
        "refreshAccessToken"
      ).mockRejectedValue(new UserError("Your session has expired."));
      try {
        expect(await loadCredentials()).toEqual({
          token: "ag_beta_legacy",
          github_user: "octocat",
        });
      } finally {
        refreshSpy.mockRestore();
        fillSpy.mockRestore();
      }
    });

    test("propagates a fault that is not a signed-out state", async () => {
      const stale = {
        accessToken: "ey.stale",
        refreshToken: "refresh-old",
        expiresAt: Date.now() - 1_000,
      };
      const fillSpy = spyOn(Bun, "spawn").mockImplementation(() =>
        gitCredentialStub("octocat", JSON.stringify(stale))
      );
      const refreshSpy = spyOn(
        logtoMod,
        "refreshAccessToken"
      ).mockRejectedValue(new TypeError("boom"));
      try {
        expect(await rejectionMessage(loadCredentials())).toContain("boom");
      } finally {
        refreshSpy.mockRestore();
        fillSpy.mockRestore();
      }
    });
  });
});
