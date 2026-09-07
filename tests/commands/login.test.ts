// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// ---------------------------------------------------------------------------
// All mocking uses spyOn on imported namespace objects. This avoids
// mock.module() which leaks globally in Bun and breaks other test files
// that import the real credential-store, telemetry, or sentry modules.
// ---------------------------------------------------------------------------

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  type Mock,
  spyOn,
  test,
} from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerLoginCommand } from "../../src/commands/login";
import * as credentialStore from "../../src/helpers/credential-store";
import * as exitMod from "../../src/helpers/exit";
import * as gitCredentialConfig from "../../src/helpers/git-credential-config";
import * as loginFlow from "../../src/helpers/login-flow";
import * as paths from "../../src/helpers/paths";
import * as telemetry from "../../src/helpers/telemetry";
import { rejectionMessage } from "../test-utils";

// ---------------------------------------------------------------------------
// Tests — Registration
// ---------------------------------------------------------------------------

/** Everything a console spy received, one line per call. */
function printed(spy: Mock<(...args: unknown[]) => void>): string {
  return spy.mock.calls
    .map((c: unknown[]) => c.map(String).join(" "))
    .join("\n");
}

describe("registerLoginCommand", () => {
  test("registers 'login' as a subcommand", () => {
    const program = new Command();
    registerLoginCommand(program);
    const sub = program.commands.find((c) => c.name() === "login");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const program = new Command();
    registerLoginCommand(program);
    const sub = program.commands.find((c) => c.name() === "login")!;
    expect(sub.description()).toBeTruthy();
  });

  test("registers status subcommand", () => {
    const program = new Command();
    registerLoginCommand(program);
    const login = program.commands.find((c) => c.name() === "login")!;
    const status = login.commands.find((c) => c.name() === "status");
    expect(status).toBeDefined();
  });

  test("registers logout subcommand", () => {
    const program = new Command();
    registerLoginCommand(program);
    const login = program.commands.find((c) => c.name() === "login")!;
    const logout = login.commands.find((c) => c.name() === "logout");
    expect(logout).toBeDefined();
  });

  test("registers refresh subcommand", () => {
    const program = new Command();
    registerLoginCommand(program);
    const login = program.commands.find((c) => c.name() === "login")!;
    const refresh = login.commands.find((c) => c.name() === "refresh");
    expect(refresh).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests — Action handlers
// ---------------------------------------------------------------------------

describe("login action handlers", () => {
  let logSpy: Mock<typeof console.log>;
  let errorSpy: Mock<typeof console.error>;
  let loadCredentialsSpy: Mock<typeof credentialStore.loadCredentials>;
  let loadTokenSetSpy: Mock<typeof credentialStore.loadTokenSet>;
  let clearCredentialsSpy: Mock<typeof credentialStore.clearCredentials>;
  let ensureHelperSpy: Mock<
    typeof gitCredentialConfig.ensureGitCredentialHelper
  >;
  // Stubbed so logout does not run `git config --global` against the real
  // machine's configuration.
  let unregisterHelperSpy: Mock<
    typeof gitCredentialConfig.unregisterGitCredentialHelper
  >;
  let runLoginFlowSpy: Mock<typeof loginFlow.runLoginFlow>;
  let exitWithSpy: Mock<typeof exitMod.exitWith>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    loadCredentialsSpy = spyOn(credentialStore, "loadCredentials");
    loadTokenSetSpy = spyOn(credentialStore, "loadTokenSet").mockResolvedValue(
      null
    );
    clearCredentialsSpy = spyOn(credentialStore, "clearCredentials");
    ensureHelperSpy = spyOn(
      gitCredentialConfig,
      "ensureGitCredentialHelper"
    ).mockResolvedValue();
    unregisterHelperSpy = spyOn(
      gitCredentialConfig,
      "unregisterGitCredentialHelper"
    ).mockResolvedValue(true);
    runLoginFlowSpy = spyOn(loginFlow, "runLoginFlow");
    spyOn(telemetry, "trackLoginResult").mockImplementation(() => {});
    // Stub exitWith to throw instead of calling process.exit — avoids
    // needing to mock telemetry flush / sentry flush internals.
    exitWithSpy = spyOn(exitMod, "exitWith").mockImplementation(
      (code: number) => {
        throw new Error(`exitWith(${String(code)})`);
      }
    );
  });

  afterEach(() => {
    mock.restore();
  });

  function makeProgram(): Command {
    const program = new Command().exitOverride();
    registerLoginCommand(program);
    return program;
  }

  // -------------------------------------------------------------------------
  // login status
  // -------------------------------------------------------------------------

  describe("status", () => {
    test("prints 'Logged in as X' when credentials are present", async () => {
      loadCredentialsSpy.mockResolvedValueOnce({
        token: "tok_test",
        github_user: "octocat",
      });

      const program = makeProgram();
      await program.parseAsync(["node", "test", "login", "status"]);

      const allOutput = printed(logSpy);
      expect(allOutput).toContain("Logged in as");
      expect(allOutput).toContain("octocat");
    });

    test("prints 'Not logged in' when no credentials exist", async () => {
      loadCredentialsSpy.mockResolvedValueOnce(null);

      const program = makeProgram();
      await program.parseAsync(["node", "test", "login", "status"]);

      const allOutput = printed(logSpy);
      expect(allOutput).toContain("Not logged in");
    });

    test("exits with code 2 when loadCredentials throws (unexpected)", async () => {
      loadCredentialsSpy.mockRejectedValueOnce(
        new Error("credential store unavailable")
      );

      const program = makeProgram();
      expect(
        program.parseAsync(["node", "test", "login", "status"])
      ).rejects.toThrow("exitWith(2)");

      expect(exitWithSpy.mock.calls.at(-1)?.[0]).toBe(2);
      const allErrors = printed(errorSpy);
      expect(allErrors).toContain("credential store unavailable");
    });
  });

  // -------------------------------------------------------------------------
  // login logout
  // -------------------------------------------------------------------------

  describe("logout", () => {
    test("calls clearCredentials and prints success", async () => {
      clearCredentialsSpy.mockResolvedValueOnce(true);

      const program = makeProgram();
      await program.parseAsync(["node", "test", "login", "logout"]);

      expect(clearCredentialsSpy).toHaveBeenCalled();
      const allOutput = printed(logSpy);
      expect(allOutput).toContain("Logged out successfully");
    });

    // While archgate is the helper for the plugins host, a legacy token in
    // the OS store is invisible to clearing and would outlive the logout.
    test("unregisters the git helper before clearing credentials", async () => {
      const order: string[] = [];
      unregisterHelperSpy.mockImplementation(async () => {
        order.push("unregister");
        return true;
      });
      clearCredentialsSpy.mockImplementation(async () => {
        order.push("clear");
        return true;
      });

      const program = makeProgram();
      await program.parseAsync(["node", "test", "login", "logout"]);

      expect(order).toEqual(["unregister", "clear"]);
    });

    test("reports a partial logout when a record cannot be removed", async () => {
      clearCredentialsSpy.mockResolvedValueOnce(false);

      const program = makeProgram();
      expect(
        await rejectionMessage(
          program.parseAsync(["node", "test", "login", "logout"])
        )
      ).toContain("exitWith(1)");

      const allErrors = printed(errorSpy);
      expect(allErrors).toContain("could not be removed");
    });

    test("still clears credentials when the helper entry cannot be removed", async () => {
      clearCredentialsSpy.mockResolvedValueOnce(true);
      unregisterHelperSpy.mockResolvedValue(false);

      const program = makeProgram();
      expect(
        await rejectionMessage(
          program.parseAsync(["node", "test", "login", "logout"])
        )
      ).toContain("exitWith(1)");

      expect(clearCredentialsSpy).toHaveBeenCalled();
    });

    test("fails when the git credential helper entry cannot be removed", async () => {
      clearCredentialsSpy.mockResolvedValueOnce(true);
      unregisterHelperSpy.mockResolvedValue(false);

      const program = makeProgram();
      expect(
        program.parseAsync(["node", "test", "login", "logout"])
      ).rejects.toThrow("exitWith(1)");
    });

    test("exits with code 2 when clearCredentials throws (unexpected)", async () => {
      clearCredentialsSpy.mockRejectedValueOnce(new Error("clear failed"));

      const program = makeProgram();
      expect(
        program.parseAsync(["node", "test", "login", "logout"])
      ).rejects.toThrow("exitWith(2)");

      expect(exitWithSpy.mock.calls.at(-1)?.[0]).toBe(2);
      const allErrors = printed(errorSpy);
      expect(allErrors).toContain("clear failed");
    });
  });

  // -------------------------------------------------------------------------
  // login (root action)
  // -------------------------------------------------------------------------

  describe("login (root)", () => {
    test("prints 'Already logged in' when credentials exist", async () => {
      loadCredentialsSpy.mockResolvedValueOnce({
        token: "tok_existing",
        github_user: "octocat",
      });

      const program = makeProgram();
      await program.parseAsync(["node", "test", "login"]);

      // logInfo writes to console.log with "info:" prefix
      const allOutput = printed(logSpy);
      expect(allOutput).toContain("Already logged in");
      expect(allOutput).toContain("octocat");
      expect(runLoginFlowSpy).not.toHaveBeenCalled();
    });

    // A first sign-in can store the session yet fail the git config write, so
    // a repeat login re-registers the helper instead of being a no-op.
    test("re-registers the git helper for a stored platform session", async () => {
      loadCredentialsSpy.mockResolvedValueOnce({
        token: "ey.access",
        github_user: "octocat",
      });
      loadTokenSetSpy.mockResolvedValueOnce({
        user: "octocat",
        tokens: {
          accessToken: "ey.access",
          refreshToken: "refresh-abc",
          expiresAt: Date.now() + 3_600_000,
        },
      });

      const program = makeProgram();
      await program.parseAsync(["node", "test", "login"]);

      expect(ensureHelperSpy).toHaveBeenCalled();
    });

    // The helper serves platform sessions only; registering it for a legacy
    // token would hide that token from git.
    test("leaves the git helper alone for a legacy token", async () => {
      loadCredentialsSpy.mockResolvedValueOnce({
        token: "ag_beta_legacy",
        github_user: "octocat",
      });

      const program = makeProgram();
      await program.parseAsync(["node", "test", "login"]);

      expect(ensureHelperSpy).not.toHaveBeenCalled();
    });

    test("exits with code 1 when login flow fails", async () => {
      loadCredentialsSpy.mockResolvedValueOnce(null);
      runLoginFlowSpy.mockResolvedValueOnce({ ok: false });

      const program = makeProgram();
      expect(program.parseAsync(["node", "test", "login"])).rejects.toThrow(
        /exitWith/u
      );

      // First exitWith call is the direct exitWith(1) from the command
      expect(exitWithSpy.mock.calls[0]?.[0]).toBe(1);
    });

    test("prints next step after successful login flow", async () => {
      loadCredentialsSpy.mockResolvedValueOnce(null);
      runLoginFlowSpy.mockResolvedValueOnce({
        ok: true,
        accountName: "octocat",
      });

      const program = makeProgram();
      await program.parseAsync(["node", "test", "login"]);

      const allOutput = printed(logSpy);
      // printNextStep prints either "archgate check" or "archgate init"
      expect(allOutput).toMatch(/archgate (check|init)/u);
    });

    test("next step is `archgate check` when a project root is present", async () => {
      loadCredentialsSpy.mockResolvedValueOnce(null);
      runLoginFlowSpy.mockResolvedValueOnce({
        ok: true,
        accountName: "octocat",
      });
      const rootSpy = spyOn(paths, "findProjectRoot").mockReturnValue(
        "/fake/project"
      );

      try {
        const program = makeProgram();
        await program.parseAsync(["node", "test", "login"]);

        const allOutput = printed(logSpy);
        expect(allOutput).toContain("archgate check");
      } finally {
        rootSpy.mockRestore();
      }
    });

    test("next step is `archgate init` when no project root is found", async () => {
      loadCredentialsSpy.mockResolvedValueOnce(null);
      runLoginFlowSpy.mockResolvedValueOnce({
        ok: true,
        accountName: "octocat",
      });
      const rootSpy = spyOn(paths, "findProjectRoot").mockReturnValue(null);

      try {
        const program = makeProgram();
        await program.parseAsync(["node", "test", "login"]);

        const allOutput = printed(logSpy);
        expect(allOutput).toContain("archgate init");
        expect(allOutput).not.toContain("archgate check");
      } finally {
        rootSpy.mockRestore();
      }
    });

    test("exits with code 1 and prints TLS hint on TLS error", async () => {
      loadCredentialsSpy.mockResolvedValueOnce(null);
      runLoginFlowSpy.mockRejectedValueOnce(
        new Error("self signed certificate")
      );

      const program = makeProgram();
      expect(program.parseAsync(["node", "test", "login"])).rejects.toThrow(
        "exitWith(1)"
      );

      expect(exitWithSpy.mock.calls.at(-1)?.[0]).toBe(1);
      const allErrors = printed(errorSpy);
      expect(allErrors).toContain("TLS certificate verification failed");
    });

    test("exits with code 2 on non-TLS unexpected error", async () => {
      loadCredentialsSpy.mockResolvedValueOnce(null);
      runLoginFlowSpy.mockRejectedValueOnce(new Error("network timeout"));

      const program = makeProgram();
      expect(program.parseAsync(["node", "test", "login"])).rejects.toThrow(
        "exitWith(2)"
      );

      expect(exitWithSpy.mock.calls.at(-1)?.[0]).toBe(2);
      const allErrors = printed(errorSpy);
      expect(allErrors).toContain("network timeout");
    });
  });

  // -------------------------------------------------------------------------
  // login refresh
  // -------------------------------------------------------------------------

  describe("refresh", () => {
    test("unregisters the helper, clears credentials, then runs login flow", async () => {
      const order: string[] = [];
      unregisterHelperSpy.mockImplementation(async () => {
        order.push("unregister");
        return true;
      });
      clearCredentialsSpy.mockImplementation(async () => {
        order.push("clear");
        return true;
      });
      runLoginFlowSpy.mockImplementation(async () => {
        order.push("login");
        return { ok: true, accountName: "octocat" };
      });

      const program = makeProgram();
      await program.parseAsync(["node", "test", "login", "refresh"]);

      expect(order).toEqual(["unregister", "clear", "login"]);
    });

    // A leftover record would keep answering for the old account.
    test("stops when credentials could not be cleared", async () => {
      clearCredentialsSpy.mockResolvedValueOnce(false);

      const program = makeProgram();
      expect(
        await rejectionMessage(
          program.parseAsync(["node", "test", "login", "refresh"])
        )
      ).toContain("exitWith(1)");

      expect(runLoginFlowSpy).not.toHaveBeenCalled();
    });

    test("exits with code 1 when refresh login flow fails", async () => {
      clearCredentialsSpy.mockResolvedValueOnce(true);
      runLoginFlowSpy.mockResolvedValueOnce({ ok: false });

      const program = makeProgram();
      expect(
        program.parseAsync(["node", "test", "login", "refresh"])
      ).rejects.toThrow(/exitWith/u);

      // First exitWith call is the direct exitWith(1) from the command
      expect(exitWithSpy.mock.calls[0]?.[0]).toBe(1);
    });

    test("exits with code 1 and prints TLS hint on TLS error during refresh", async () => {
      clearCredentialsSpy.mockResolvedValueOnce(true);
      runLoginFlowSpy.mockRejectedValueOnce(
        new Error("unable to verify the first certificate")
      );

      const program = makeProgram();
      expect(
        program.parseAsync(["node", "test", "login", "refresh"])
      ).rejects.toThrow("exitWith(1)");

      expect(exitWithSpy.mock.calls.at(-1)?.[0]).toBe(1);
      const allErrors = printed(errorSpy);
      expect(allErrors).toContain("TLS certificate verification failed");
    });

    test("exits with code 2 on non-TLS unexpected error during refresh", async () => {
      clearCredentialsSpy.mockResolvedValueOnce(true);
      runLoginFlowSpy.mockRejectedValueOnce(new Error("server unreachable"));

      const program = makeProgram();
      expect(
        program.parseAsync(["node", "test", "login", "refresh"])
      ).rejects.toThrow("exitWith(2)");

      expect(exitWithSpy.mock.calls.at(-1)?.[0]).toBe(2);
      const allErrors = printed(errorSpy);
      expect(allErrors).toContain("server unreachable");
    });
  });
});
