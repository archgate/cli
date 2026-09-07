// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
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

import {
  isCredentialHelperInvocation,
  registerCredentialCommand,
} from "../../src/commands/credential";
import * as credMod from "../../src/helpers/credential-store";
import * as exitModule from "../../src/helpers/exit";
import * as stdinMod from "../../src/helpers/stdin";
import { rejectionMessage } from "../test-utils";

let stdoutSpy: Mock<typeof process.stdout.write>;
let resolveSpy: Mock<typeof credMod.resolveAccessToken>;
let invalidateSpy: Mock<typeof credMod.invalidateAccessToken>;

/** Everything the command wrote to stdout during one run. */
function written(): string {
  return stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
}

/** Run a `credential` subcommand with the given request on stdin. */
async function run(subcommand: string, request: string): Promise<void> {
  spyOn(stdinMod, "readStdinText").mockResolvedValue(request);
  const program = new Command();
  program.exitOverride();
  registerCredentialCommand(program);
  await program.parseAsync(["node", "archgate", "credential", subcommand]);
}

const PLUGIN_REQUEST = "protocol=https\nhost=plugins.archgate.dev\n\n";

beforeEach(() => {
  stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
  resolveSpy = spyOn(credMod, "resolveAccessToken").mockResolvedValue({
    token: "ey.access",
    github_user: "octocat",
  });
  invalidateSpy = spyOn(credMod, "invalidateAccessToken").mockResolvedValue(
    true
  );
});

afterEach(() => {
  mock.restore();
});

// Git starts the helper with stdout as the protocol channel, so startup must
// not run the git install check, which logs and may spawn an installer.
describe("isCredentialHelperInvocation", () => {
  test.each([
    [["bun", "archgate", "credential", "get"], true],
    [["bun", "archgate", "--log-level", "debug", "credential", "get"], true],
    [["bun", "archgate", "login"], false],
    [["bun", "archgate"], false],
  ])("%p → %p", (argv, expected) => {
    expect(isCredentialHelperInvocation(argv)).toBe(expected);
  });
});

describe("archgate credential get", () => {
  test("answers with the stored username and access token", async () => {
    await run("get", PLUGIN_REQUEST);

    expect(written()).toBe(
      "protocol=https\nhost=plugins.archgate.dev\nusername=octocat\npassword=ey.access\n\n"
    );
  });

  // Silence tells git to fall through to its other helpers rather than fail.
  test("prints nothing when signed out", async () => {
    resolveSpy.mockResolvedValue(null);

    await run("get", PLUGIN_REQUEST);

    expect(written()).toBe("");
  });

  // Git uses the requested protocol for the exchange, so answering a plain
  // http request would hand the token over in cleartext.
  test.each([
    "protocol=https\nhost=github.com\n\n",
    "protocol=https\nhost=evil.example.com\n\n",
    "protocol=https\n\n",
    "protocol=http\nhost=plugins.archgate.dev\n\n",
    "host=plugins.archgate.dev\n\n",
  ])("stays silent for a request that is not ours (%p)", async (request) => {
    await run("get", request);

    expect(written()).toBe("");
    expect(resolveSpy).not.toHaveBeenCalled();
  });
});

describe("archgate credential erase", () => {
  // Git erases on any rejection, so this must cost the access token only —
  // dropping the refresh token would turn a 401 into a full re-login.
  test("drops only the access token, keeping the session", async () => {
    await run("erase", PLUGIN_REQUEST);

    expect(invalidateSpy).toHaveBeenCalled();
  });

  test.each([
    "protocol=https\nhost=github.com\n\n",
    "protocol=http\nhost=plugins.archgate.dev\n\n",
  ])("leaves credentials alone for %p", async (request) => {
    await run("erase", request);

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("archgate credential store", () => {
  test("consumes the request without touching stored credentials", async () => {
    await run("store", PLUGIN_REQUEST);

    expect(written()).toBe("");
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(resolveSpy).not.toHaveBeenCalled();
  });
});

// Each action wraps its body in the command error boundary; a failure there
// must be routed through handleCommandError rather than escaping the process.
describe("error boundaries", () => {
  test.each(["get", "store", "erase"])(
    "%s routes a stdin failure to the error handler",
    async (subcommand) => {
      spyOn(stdinMod, "readStdinText").mockRejectedValue(
        new Error("stdin closed")
      );
      const exitSpy = spyOn(exitModule, "exitWith").mockImplementation(() => {
        throw new Error("process.exit");
      });
      const program = new Command();
      program.exitOverride();
      registerCredentialCommand(program);

      try {
        expect(
          await rejectionMessage(
            program.parseAsync(["node", "archgate", "credential", subcommand])
          )
        ).toContain("process.exit");
      } finally {
        exitSpy.mockRestore();
      }
    }
  );
});
