// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// ---------------------------------------------------------------------------
// All mocking uses spyOn on imported namespace objects. This avoids
// mock.module() which leaks globally in Bun and breaks other test files
// that import the real credential-store, telemetry, or sentry modules.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerLoginCommand } from "../../src/commands/login";
import * as credentialStore from "../../src/helpers/credential-store";
import * as exitMod from "../../src/helpers/exit";
import * as loginFlow from "../../src/helpers/login-flow";
import * as telemetry from "../../src/helpers/telemetry";

// ---------------------------------------------------------------------------
// Tests — Registration
// ---------------------------------------------------------------------------

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
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let loadCredentialsSpy: ReturnType<typeof spyOn>;
  let clearCredentialsSpy: ReturnType<typeof spyOn>;
  let runLoginFlowSpy: ReturnType<typeof spyOn>;
  let exitWithSpy: ReturnType<typeof spyOn>;
  let trackLoginSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    loadCredentialsSpy = spyOn(credentialStore, "loadCredentials");
    clearCredentialsSpy = spyOn(credentialStore, "clearCredentials");
    runLoginFlowSpy = spyOn(loginFlow, "runLoginFlow");
    trackLoginSpy = spyOn(telemetry, "trackLoginResult").mockImplementation(
      () => {}
    );
    // Stub exitWith to throw instead of calling process.exit — avoids
    // needing to mock telemetry flush / sentry flush internals.
    exitWithSpy = spyOn(exitMod, "exitWith").mockImplementation(
      (code: number) => {
        throw new Error(`exitWith(${String(code)})`);
      }
    );
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    loadCredentialsSpy.mockRestore();
    clearCredentialsSpy.mockRestore();
    runLoginFlowSpy.mockRestore();
    exitWithSpy.mockRestore();
    trackLoginSpy.mockRestore();
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

      const allOutput = logSpy.mock.calls
        .map((c: unknown[]) => c.map(String).join(" "))
        .join("\n");
      expect(allOutput).toContain("Logged in as");
      expect(allOutput).toContain("octocat");
    });

    test("prints 'Not logged in' when no credentials exist", async () => {
      loadCredentialsSpy.mockResolvedValueOnce(null);

      const program = makeProgram();
      await program.parseAsync(["node", "test", "login", "status"]);

      const allOutput = logSpy.mock.calls
        .map((c: unknown[]) => c.map(String).join(" "))
        .join("\n");
      expect(allOutput).toContain("Not logged in");
    });

    test("exits with code 2 when loadCredentials throws (unexpected)", async () => {
      loadCredentialsSpy.mockRejectedValueOnce(
        new Error("credential store unavailable")
      );

      const program = makeProgram();
      await expect(
        program.parseAsync(["node", "test", "login", "status"])
      ).rejects.toThrow("exitWith(2)");

      expect(exitWithSpy.mock.calls.at(-1)?.[0]).toBe(2);
      const allErrors = errorSpy.mock.calls
        .map((c: unknown[]) => c.map(String).join(" "))
        .join("\n");
      expect(allErrors).toContain("credential store unavailable");
    });
  });

  // -------------------------------------------------------------------------
  // login logout
  // -------------------------------------------------------------------------

  describe("logout", () => {
    test("calls clearCredentials and prints success", async () => {
      clearCredentialsSpy.mockResolvedValueOnce();

      const program = makeProgram();
      await program.parseAsync(["node", "test", "login", "logout"]);

      expect(clearCredentialsSpy).toHaveBeenCalled();
      const allOutput = logSpy.mock.calls
        .map((c: unknown[]) => c.map(String).join(" "))
        .join("\n");
      expect(allOutput).toContain("Logged out successfully");
    });

    test("exits with code 2 when clearCredentials throws (unexpected)", async () => {
      clearCredentialsSpy.mockRejectedValueOnce(new Error("clear failed"));

      const program = makeProgram();
      await expect(
        program.parseAsync(["node", "test", "login", "logout"])
      ).rejects.toThrow("exitWith(2)");

      expect(exitWithSpy.mock.calls.at(-1)?.[0]).toBe(2);
      const allErrors = errorSpy.mock.calls
        .map((c: unknown[]) => c.map(String).join(" "))
        .join("\n");
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
      const allOutput = logSpy.mock.calls
        .map((c: unknown[]) => c.map(String).join(" "))
        .join("\n");
      expect(allOutput).toContain("Already logged in");
      expect(allOutput).toContain("octocat");
      // runLoginFlow should NOT have been called
      expect(runLoginFlowSpy).not.toHaveBeenCalled();
    });

    test("exits with code 1 when login flow fails", async () => {
      loadCredentialsSpy.mockResolvedValueOnce(null);
      runLoginFlowSpy.mockResolvedValueOnce({ ok: false });

      const program = makeProgram();
      await expect(
        program.parseAsync(["node", "test", "login"])
      ).rejects.toThrow(/exitWith/u);

      // First exitWith call is the direct exitWith(1) from the command
      expect(exitWithSpy.mock.calls[0]?.[0]).toBe(1);
    });

    test("prints next step after successful login flow", async () => {
      loadCredentialsSpy.mockResolvedValueOnce(null);
      runLoginFlowSpy.mockResolvedValueOnce({
        ok: true,
        githubUser: "octocat",
      });

      const program = makeProgram();
      await program.parseAsync(["node", "test", "login"]);

      const allOutput = logSpy.mock.calls
        .map((c: unknown[]) => c.map(String).join(" "))
        .join("\n");
      // printNextStep prints either "archgate check" or "archgate init"
      expect(allOutput).toMatch(/archgate (check|init)/u);
    });

    test("exits with code 1 and prints TLS hint on TLS error", async () => {
      loadCredentialsSpy.mockResolvedValueOnce(null);
      runLoginFlowSpy.mockRejectedValueOnce(
        new Error("self signed certificate")
      );

      const program = makeProgram();
      await expect(
        program.parseAsync(["node", "test", "login"])
      ).rejects.toThrow("exitWith(1)");

      expect(exitWithSpy).toHaveBeenCalledWith(1);
      const allErrors = errorSpy.mock.calls
        .map((c: unknown[]) => c.map(String).join(" "))
        .join("\n");
      expect(allErrors).toContain("TLS certificate verification failed");
    });

    test("exits with code 2 on non-TLS unexpected error", async () => {
      loadCredentialsSpy.mockResolvedValueOnce(null);
      runLoginFlowSpy.mockRejectedValueOnce(new Error("network timeout"));

      const program = makeProgram();
      await expect(
        program.parseAsync(["node", "test", "login"])
      ).rejects.toThrow("exitWith(2)");

      expect(exitWithSpy.mock.calls.at(-1)?.[0]).toBe(2);
      const allErrors = errorSpy.mock.calls
        .map((c: unknown[]) => c.map(String).join(" "))
        .join("\n");
      expect(allErrors).toContain("network timeout");
    });
  });

  // -------------------------------------------------------------------------
  // login refresh
  // -------------------------------------------------------------------------

  describe("refresh", () => {
    test("clears credentials then runs login flow", async () => {
      clearCredentialsSpy.mockResolvedValueOnce();
      runLoginFlowSpy.mockResolvedValueOnce({
        ok: true,
        githubUser: "octocat",
      });

      const program = makeProgram();
      await program.parseAsync(["node", "test", "login", "refresh"]);

      expect(clearCredentialsSpy).toHaveBeenCalled();
      expect(runLoginFlowSpy).toHaveBeenCalled();
    });

    test("exits with code 1 when refresh login flow fails", async () => {
      clearCredentialsSpy.mockResolvedValueOnce();
      runLoginFlowSpy.mockResolvedValueOnce({ ok: false });

      const program = makeProgram();
      await expect(
        program.parseAsync(["node", "test", "login", "refresh"])
      ).rejects.toThrow(/exitWith/u);

      // First exitWith call is the direct exitWith(1) from the command
      expect(exitWithSpy.mock.calls[0]?.[0]).toBe(1);
    });

    test("exits with code 1 and prints TLS hint on TLS error during refresh", async () => {
      clearCredentialsSpy.mockResolvedValueOnce();
      runLoginFlowSpy.mockRejectedValueOnce(
        new Error("unable to verify the first certificate")
      );

      const program = makeProgram();
      await expect(
        program.parseAsync(["node", "test", "login", "refresh"])
      ).rejects.toThrow("exitWith(1)");

      expect(exitWithSpy).toHaveBeenCalledWith(1);
      const allErrors = errorSpy.mock.calls
        .map((c: unknown[]) => c.map(String).join(" "))
        .join("\n");
      expect(allErrors).toContain("TLS certificate verification failed");
    });

    test("exits with code 2 on non-TLS unexpected error during refresh", async () => {
      clearCredentialsSpy.mockResolvedValueOnce();
      runLoginFlowSpy.mockRejectedValueOnce(new Error("server unreachable"));

      const program = makeProgram();
      await expect(
        program.parseAsync(["node", "test", "login", "refresh"])
      ).rejects.toThrow("exitWith(2)");

      expect(exitWithSpy.mock.calls.at(-1)?.[0]).toBe(2);
      const allErrors = errorSpy.mock.calls
        .map((c: unknown[]) => c.map(String).join(" "))
        .join("\n");
      expect(allErrors).toContain("server unreachable");
    });
  });
});
