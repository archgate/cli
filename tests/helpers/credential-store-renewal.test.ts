// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import * as credentialStore from "../../src/helpers/credential-store";
import {
  clearCredentials,
  invalidateAccessToken,
  loadCredentials,
  resolveAccessToken,
} from "../../src/helpers/credential-store";
import * as logMod from "../../src/helpers/log";
import { platformAuth } from "../../src/helpers/platform-auth";
import type { TokenSet } from "../../src/helpers/platform-auth";
import * as refreshLock from "../../src/helpers/refresh-lock";
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

/** The record `saveTokenSet` files: one fixed account, the session as JSON. */
function sessionRecord(
  user: string,
  tokens: TokenSet
): ReturnType<typeof Bun.spawn> {
  return gitCredentialStub("archgate", JSON.stringify({ user, tokens }));
}

// The lock itself is covered in refresh-lock.test.ts; here it only has to
// stay out of the real home directory.
let lockSpy: ReturnType<typeof spyOn<typeof refreshLock, "withRefreshLock">>;
beforeEach(() => {
  lockSpy = spyOn(refreshLock, "withRefreshLock").mockImplementation(
    async (task) => task()
  );
});
afterEach(() => {
  lockSpy.mockRestore();
});

/** The stdin of every `git credential <action>` call the spy recorded. */
async function stdinOf(
  spawnSpy: ReturnType<typeof spyOn<typeof Bun, "spawn">>,
  action: string
): Promise<string[]> {
  return Promise.all(
    spawnSpy.mock.calls
      .filter((call) => [...call[0]].includes(action))
      .map(async (call) => {
        const stdin = (call[1] as { stdin?: unknown } | undefined)?.stdin;
        return stdin instanceof Blob ? stdin.text() : "";
      })
  );
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
        return sessionRecord(
          "octocat",
          call >= 3 ? { ...tokens, expiresAt: 0 } : tokens
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
        sessionRecord("octocat", tokens)
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
      sessionRecord("octocat", stale)
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
      sessionRecord("octocat", stale)
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
      sessionRecord("octocat", stale)
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
      sessionRecord("octocat", stale)
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
  });
});

// Git runs the helper several times per operation, often in parallel. The
// platform rotates the refresh token and revokes the grant when an old one is
// replayed, so renewal runs under a lock and re-reads the session inside it.
describe("renewal under the refresh lock", () => {
  const expired = {
    accessToken: "ey.stale",
    refreshToken: "refresh-old",
    expiresAt: Date.now() - 1_000,
  };
  const rotated = {
    accessToken: "ey.fromHolder",
    refreshToken: "refresh-rotated",
    expiresAt: Date.now() + 3_600_000,
  };

  /** A `git credential` call that exits non-zero. */
  function failingCall(): ReturnType<typeof Bun.spawn> {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return {
      stdout: new Response("").body,
      exited: Promise.resolve(1),
      kill: () => {
        // Nothing to kill: the stub has already settled.
      },
    } as unknown as ReturnType<typeof Bun.spawn>;
  }

  test("runs the renewal inside the lock", async () => {
    const fillSpy = spyOn(Bun, "spawn").mockImplementation(() =>
      sessionRecord("octocat", expired)
    );
    const refreshSpy = spyOn(
      platformAuth,
      "refreshAccessToken"
    ).mockResolvedValue(rotated);
    const saveSpy = spyOn(credentialStore, "saveTokenSet").mockResolvedValue(
      true
    );
    try {
      expect(await resolveAccessToken()).toEqual({
        token: "ey.fromHolder",
        github_user: "octocat",
      });
      expect(lockSpy).toHaveBeenCalledTimes(1);
    } finally {
      saveSpy.mockRestore();
      refreshSpy.mockRestore();
      fillSpy.mockRestore();
    }
  });

  test("uses the token set the lock holder saved, without exchanging", async () => {
    let read = 0;
    const fillSpy = spyOn(Bun, "spawn").mockImplementation(() => {
      read += 1;
      return sessionRecord("octocat", read === 1 ? expired : rotated);
    });
    const refreshSpy = spyOn(platformAuth, "refreshAccessToken");
    try {
      expect(await resolveAccessToken()).toEqual({
        token: "ey.fromHolder",
        github_user: "octocat",
      });
      expect(refreshSpy).not.toHaveBeenCalled();
    } finally {
      refreshSpy.mockRestore();
      fillSpy.mockRestore();
    }
  });

  test("reports signed out when the session is gone once the lock is held", async () => {
    let read = 0;
    const fillSpy = spyOn(Bun, "spawn").mockImplementation(() => {
      read += 1;
      return read === 1
        ? sessionRecord("octocat", expired)
        : gitCredentialStub("", "");
    });
    const refreshSpy = spyOn(platformAuth, "refreshAccessToken");
    try {
      expect(await resolveAccessToken()).toBeNull();
      expect(refreshSpy).not.toHaveBeenCalled();
    } finally {
      refreshSpy.mockRestore();
      fillSpy.mockRestore();
    }
  });

  // Keeping a refused session would send the same dead token on every later
  // lookup.
  test("removes the session whose refresh token was refused", async () => {
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() =>
      sessionRecord("octocat", expired)
    );
    const refreshSpy = spyOn(
      platformAuth,
      "refreshAccessToken"
    ).mockRejectedValue(new SessionExpiredError());
    try {
      expect(await rejectionMessage(resolveAccessToken())).toContain(
        "session has expired"
      );
      const rejected = await stdinOf(spawnSpy, "reject");
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toContain("host=auth.archgate.dev");
      expect(rejected[0]).toContain("refresh-old");
    } finally {
      refreshSpy.mockRestore();
      spawnSpy.mockRestore();
    }
  });

  // `archgate login` does not take the lock, so a sign-in can land between
  // the refused exchange and the removal.
  test("uses a session saved elsewhere after the refusal", async () => {
    let read = 0;
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
      read += 1;
      return sessionRecord("octocat", read <= 2 ? expired : rotated);
    });
    const refreshSpy = spyOn(
      platformAuth,
      "refreshAccessToken"
    ).mockRejectedValue(new SessionExpiredError());
    try {
      expect(await resolveAccessToken()).toEqual({
        token: "ey.fromHolder",
        github_user: "octocat",
      });
      expect(await stdinOf(spawnSpy, "reject")).toHaveLength(0);
    } finally {
      refreshSpy.mockRestore();
      spawnSpy.mockRestore();
    }
  });

  test.each([
    ["no record", () => gitCredentialStub("", "")],
    ["an unreadable record", () => gitCredentialStub("archgate", "not-json")],
  ])("removes nothing when the store then holds %s", async (_label, later) => {
    let read = 0;
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
      read += 1;
      return read <= 2 ? sessionRecord("octocat", expired) : later();
    });
    const refreshSpy = spyOn(
      platformAuth,
      "refreshAccessToken"
    ).mockRejectedValue(new SessionExpiredError());
    try {
      expect(await rejectionMessage(resolveAccessToken())).toContain(
        "session has expired"
      );
      expect(await stdinOf(spawnSpy, "reject")).toHaveLength(0);
    } finally {
      refreshSpy.mockRestore();
      spawnSpy.mockRestore();
    }
  });

  test("still reports signed out when the removal fails", async () => {
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation((cmd) =>
      Array.isArray(cmd) && cmd.includes("reject")
        ? failingCall()
        : sessionRecord("octocat", expired)
    );
    const refreshSpy = spyOn(
      platformAuth,
      "refreshAccessToken"
    ).mockRejectedValue(new SessionExpiredError());
    try {
      expect(await loadCredentials()).toBeNull();
      expect(await stdinOf(spawnSpy, "reject")).toHaveLength(1);
    } finally {
      refreshSpy.mockRestore();
      spawnSpy.mockRestore();
    }
  });

  // Only a refused grant ends the session; a service failure must leave it.
  test("keeps the session when renewal fails for another reason", async () => {
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() =>
      sessionRecord("octocat", expired)
    );
    const refreshSpy = spyOn(
      platformAuth,
      "refreshAccessToken"
    ).mockRejectedValue(new UserError("Could not reach the sign-in service."));
    try {
      expect(await rejectionMessage(resolveAccessToken())).toContain(
        "Could not reach"
      );
      expect(await stdinOf(spawnSpy, "reject")).toHaveLength(0);
    } finally {
      refreshSpy.mockRestore();
      spawnSpy.mockRestore();
    }
  });
});
