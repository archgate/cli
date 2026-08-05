// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  saveCredentials,
  loadCredentials,
  clearCredentials,
} from "../../src/helpers/credential-store";
import { restoreEnv } from "../test-utils";

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

  describe("saveCredentials", () => {
    test("does not write any metadata file to disk", async () => {
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
          await saveCredentials({
            token: "ag_beta_test",
            github_user: "testuser",
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
        await saveCredentials({
          token: "ag_beta_roundtrip",
          github_user: "rounduser",
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
        await saveCredentials({ token: "ag_beta_x", github_user: "u" });

        expect(warnSpy.mock.calls.flat().join(" ")).toContain(
          "git credential approve failed."
        );
      } finally {
        warnSpy.mockRestore();
        spawnSpy.mockRestore();
      }
    });
  });

  describe("StoredCredentials type", () => {
    test("interface has expected shape", () => {
      expect(typeof saveCredentials).toBe("function");
      expect(typeof loadCredentials).toBe("function");
      expect(typeof clearCredentials).toBe("function");
    });
  });
});
