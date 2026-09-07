// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  saveTokenSet,
  loadCredentials,
  loadTokenSet,
  resolveAccessToken,
  clearCredentials,
} from "../../src/helpers/credential-store";
import { platformAuth } from "../../src/helpers/platform-auth";
import { SessionExpiredError } from "../../src/helpers/session-expired-error";
import { rejectionMessage, restoreEnv, safeRmSync } from "../test-utils";

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
    safeRmSync(tempDir);
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

  // A newline in an account name would add a second `host=` line, and git
  // takes the later one, so the token set would be filed under that host.
  describe("credential protocol values", () => {
    test.each([
      ["a line feed", "octo\nhost=evil.example.com"],
      ["a carriage return", "octo\rhost=evil.example.com"],
      ["a NUL", "octo\0cat"],
    ])("refuses an account name holding %s", async (_label, user) => {
      const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
        throw new Error("git must not be spawned");
      });
      try {
        expect(
          await rejectionMessage(
            saveTokenSet(user, {
              accessToken: "ey.access",
              refreshToken: "refresh-abc",
              expiresAt: Date.now() + 3_600_000,
            })
          )
        ).toContain("line break");
        expect(spawnSpy).not.toHaveBeenCalled();
      } finally {
        spawnSpy.mockRestore();
      }
    });
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
    // A record the helper refuses to drop must not let logout report success.
    test("reports failure when git cannot reject a record", async () => {
      let call = 0;
      const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
        call += 1;
        // Odd calls are fills answering a record; even calls are rejects.
        const stub = gitCredentialStub("octocat", "ey.access");
        return call % 2 === 0
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion
            ({ ...stub, exited: Promise.resolve(1) } as unknown as ReturnType<
              typeof Bun.spawn
            >)
          : stub;
      });
      try {
        expect(await clearCredentials()).toBe(false);
      } finally {
        spawnSpy.mockRestore();
      }
    });

    test("does not throw when no credentials exist", async () => {
      expect(await clearCredentials()).toBe(true);
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

  // `git credential approve` exits 0 even when nothing was stored, so the
  // read-back must return this very blob for this account.
  describe("saveTokenSet verification", () => {
    const tokens = {
      accessToken: "ey.access",
      refreshToken: "refresh-abc",
      expiresAt: 1_800_000_000_000,
    };

    test("asks for the account it wrote and rejects a different blob", async () => {
      const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() =>
        gitCredentialStub("octocat", "stale-blob")
      );
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(await saveTokenSet("octocat", tokens)).toBe(false);

        const fill = spawnSpy.mock.calls.find((call) =>
          [...call[0]].includes("fill")
        );
        const stdin = (fill?.[1] as { stdin?: unknown } | undefined)?.stdin;
        expect(stdin instanceof Blob ? await stdin.text() : "").toContain(
          "username=octocat"
        );
        expect(warnSpy.mock.calls.flat().join(" ")).toContain(
          "could not be verified"
        );
      } finally {
        warnSpy.mockRestore();
        spawnSpy.mockRestore();
      }
    });

    test("accepts the read-back when it matches", async () => {
      const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() =>
        gitCredentialStub("octocat", JSON.stringify(tokens))
      );
      try {
        expect(await saveTokenSet("octocat", tokens)).toBe(true);
      } finally {
        spawnSpy.mockRestore();
      }
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

  describe("loadTokenSet", () => {
    test.each([
      ["not JSON at all", "not-json"],
      ["JSON without token fields", JSON.stringify({ a: 1 })],
    ])("returns null when the stored blob is %s", async (_label, stored) => {
      const fillSpy = spyOn(Bun, "spawn").mockImplementation(() =>
        gitCredentialStub("archgate", stored)
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
      const refreshSpy = spyOn(platformAuth, "refreshAccessToken");
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
        platformAuth,
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

  // Git runs the helper many times per operation, so processes can race to
  // refresh the same expired token set. The platform rotates the refresh
  // token, so every exchange after the first fails.
  describe("concurrent renewal", () => {
    const expired = {
      accessToken: "ey.stale",
      refreshToken: "refresh-old",
      expiresAt: Date.now() - 1_000,
    };
    const rotated = {
      accessToken: "ey.fromWinner",
      refreshToken: "refresh-rotated",
      expiresAt: Date.now() + 3_600_000,
    };

    test("uses the token another process already saved", async () => {
      let read = 0;
      const fillSpy = spyOn(Bun, "spawn").mockImplementation(() => {
        read += 1;
        return gitCredentialStub(
          "octocat",
          JSON.stringify(read === 1 ? expired : rotated)
        );
      });
      const refreshSpy = spyOn(
        platformAuth,
        "refreshAccessToken"
      ).mockRejectedValue(new SessionExpiredError());
      try {
        expect(await resolveAccessToken()).toEqual({
          token: "ey.fromWinner",
          github_user: "octocat",
        });
      } finally {
        refreshSpy.mockRestore();
        fillSpy.mockRestore();
      }
    });

    test("rethrows when the stored token set did not change", async () => {
      const fillSpy = spyOn(Bun, "spawn").mockImplementation(() =>
        gitCredentialStub("octocat", JSON.stringify(expired))
      );
      const refreshSpy = spyOn(
        platformAuth,
        "refreshAccessToken"
      ).mockRejectedValue(new SessionExpiredError());
      try {
        expect(await rejectionMessage(resolveAccessToken())).toContain(
          "session has expired"
        );
      } finally {
        refreshSpy.mockRestore();
        fillSpy.mockRestore();
      }
    });
  });
});
