// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, spyOn, test } from "bun:test";

import * as credentialStore from "../../src/helpers/credential-store";
import {
  invalidateAccessToken,
  resolveAccessToken,
} from "../../src/helpers/credential-store";
import * as logMod from "../../src/helpers/log";
import * as logtoMod from "../../src/helpers/logto-auth";

/** A `Bun.spawn` stand-in that answers `git credential fill` with one record. */
function gitCredentialStub(username: string, password: string) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return {
    stdout: new Response(`username=${username}\npassword=${password}\n`).body,
    exited: Promise.resolve(0),
    kill: () => {
      // Nothing to kill: the stub has already settled.
    },
  } as unknown as ReturnType<typeof Bun.spawn>;
}

describe("credential renewal", () => {
  describe("invalidateAccessToken", () => {
    const tokens = {
      accessToken: "ey.rejected",
      refreshToken: "refresh-keepme",
      expiresAt: Date.now() + 3_600_000,
    };

    // The refresh token must survive: git erases on any rejection, and losing
    // it would turn a recoverable 401 into a full device-flow login.
    test("expires the access token but keeps the refresh token", async () => {
      const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() =>
        gitCredentialStub("octocat", JSON.stringify(tokens))
      );
      try {
        await invalidateAccessToken();

        const approved = spawnSpy.mock.calls
          .filter((call) => [...call[0]].includes("approve"))
          .map((call) => (call[1] as { stdin?: unknown } | undefined)?.stdin)
          .filter((stdin): stdin is Blob => stdin instanceof Blob);
        const written = (
          await Promise.all(approved.map(async (b) => b.text()))
        ).join("");
        expect(written).toContain("refresh-keepme");
        expect(written).toContain('"expiresAt":0');
      } finally {
        spawnSpy.mockRestore();
      }
    });

    test("writes nothing when no token set is stored", async () => {
      const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() =>
        gitCredentialStub("", "")
      );
      try {
        await invalidateAccessToken();

        const approvals = spawnSpy.mock.calls.filter((call) =>
          [...call[0]].includes("approve")
        );
        expect(approvals).toHaveLength(0);
      } finally {
        spawnSpy.mockRestore();
      }
    });
  });

  // A rotated refresh token that cannot be written leaves the stored one dead,
  // so the failure has to be surfaced rather than swallowed.
  test("warns when renewed credentials cannot be persisted", async () => {
    const stale = {
      accessToken: "ey.stale",
      refreshToken: "refresh-old",
      expiresAt: Date.now() - 1_000,
    };
    const fillSpy = spyOn(Bun, "spawn").mockImplementation(() =>
      gitCredentialStub("octocat", JSON.stringify(stale))
    );
    const saveSpy = spyOn(credentialStore, "saveTokenSet").mockResolvedValue(
      false
    );
    const refreshSpy = spyOn(logtoMod, "refreshAccessToken").mockResolvedValue({
      accessToken: "ey.fresh",
      refreshToken: "refresh-new",
      expiresAt: Date.now() + 3_600_000,
    });
    const warnSpy = spyOn(logMod, "logWarn").mockImplementation(() => {
      // Captured, not printed.
    });
    try {
      expect(await resolveAccessToken()).toEqual({
        token: "ey.fresh",
        github_user: "octocat",
      });
      expect(warnSpy.mock.calls.flat().join(" ")).toContain("archgate login");
    } finally {
      warnSpy.mockRestore();
      refreshSpy.mockRestore();
      saveSpy.mockRestore();
      fillSpy.mockRestore();
    }
  });
});
