// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, spyOn, test } from "bun:test";

import * as credentialStore from "../../src/helpers/credential-store";
import {
  clearCredentials,
  invalidateAccessToken,
  loadCredentials,
  resolveAccessToken,
} from "../../src/helpers/credential-store";
import * as logMod from "../../src/helpers/log";
import { platformAuth } from "../../src/helpers/platform-auth";
import { SessionExpiredError } from "../../src/helpers/session-expired-error";
import { UserError } from "../../src/helpers/user-error";
import { rejectionMessage } from "../test-utils";

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
      // Calls run load-fill, approve, verify-fill; the verification must see
      // the blob that was just approved.
      let call = 0;
      const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
        call += 1;
        return gitCredentialStub(
          "octocat",
          JSON.stringify(call >= 3 ? { ...tokens, expiresAt: 0 } : tokens)
        );
      });
      try {
        expect(await invalidateAccessToken()).toBe(true);

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
        expect(await invalidateAccessToken()).toBe(false);

        const approvals = spawnSpy.mock.calls.filter((call) =>
          [...call[0]].includes("approve")
        );
        expect(approvals).toHaveLength(0);
      } finally {
        spawnSpy.mockRestore();
      }
    });

    // A store that cannot take the lapsed token set would hand git the same
    // rejected access token on the next lookup, so the failure is reported.
    test("reports when the lapsed token set cannot be stored", async () => {
      const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() =>
        gitCredentialStub("octocat", JSON.stringify(tokens))
      );
      const saveSpy = spyOn(credentialStore, "saveTokenSet").mockResolvedValue(
        false
      );
      try {
        expect(await invalidateAccessToken()).toBe(false);
      } finally {
        saveSpy.mockRestore();
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
    const refreshSpy = spyOn(
      platformAuth,
      "refreshAccessToken"
    ).mockResolvedValue({
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

// A refused refresh token is a signed-out state, and it ends the lookup: the
// legacy store is not consulted for a user who has signed in to the platform.
describe("loadCredentials with an unrenewable session", () => {
  test("reports signed out without consulting the legacy store", async () => {
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
    ).mockRejectedValue(new SessionExpiredError());
    try {
      expect(await loadCredentials()).toBeNull();

      const hosts = await Promise.all(
        fillSpy.mock.calls
          .filter((call) => [...call[0]].includes("fill"))
          .map(async (call) => {
            const stdin = (call[1] as { stdin?: unknown } | undefined)?.stdin;
            return stdin instanceof Blob ? stdin.text() : "";
          })
      );
      expect(hosts.join("")).not.toContain("plugins.archgate.dev");
    } finally {
      refreshSpy.mockRestore();
      fillSpy.mockRestore();
    }
  });

  // The service being down must not read as "not logged in".
  test("propagates a renewal failure that is not a sign-out", async () => {
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
    ).mockRejectedValue(new UserError("Could not reach the sign-in service."));
    try {
      expect(await rejectionMessage(loadCredentials())).toContain(
        "Could not reach"
      );
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
      platformAuth,
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

// A helper that never answers leaves the host's records unknown, so logout
// must not report them as removed.
describe("clearCredentials with an unresponsive helper", () => {
  test("reports failure when the fill times out", async () => {
    let call = 0;
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
      call += 1;
      if (call > 1) return gitCredentialStub("", "");
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return {
        stdout: new ReadableStream<Uint8Array>({ start() {} }),
        exited: new Promise<number>(() => {}),
        kill: () => {},
      } as unknown as ReturnType<typeof Bun.spawn>;
    });
    try {
      expect(await clearCredentials()).toBe(false);
    } finally {
      spawnSpy.mockRestore();
    }
  }, 20_000);
});
