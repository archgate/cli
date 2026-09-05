// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  spyOn,
  test,
} from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerCredentialCommand } from "../../src/commands/credential";
import * as credMod from "../../src/helpers/credential-store";

let stdinSpy: Mock<typeof Bun.stdin.text>;
let stdoutSpy: Mock<typeof process.stdout.write>;
let resolveSpy: Mock<typeof credMod.resolveAccessToken>;
let clearSpy: Mock<typeof credMod.clearCredentials>;

/** Everything the command wrote to stdout during one run. */
function written(): string {
  return stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
}

/** Run a `credential` subcommand with the given request on stdin. */
async function run(subcommand: string, request: string): Promise<void> {
  stdinSpy = spyOn(Bun.stdin, "text").mockResolvedValue(request);
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
  clearSpy = spyOn(credMod, "clearCredentials").mockResolvedValue();
});

afterEach(() => {
  stdinSpy.mockRestore();
  stdoutSpy.mockRestore();
  resolveSpy.mockRestore();
  clearSpy.mockRestore();
});

describe("archgate credential get", () => {
  test("answers with the stored username and access token", async () => {
    await run("get", PLUGIN_REQUEST);

    expect(written()).toBe(
      "protocol=https\nhost=plugins.archgate.dev\nusername=octocat\npassword=ey.access\n"
    );
  });

  // Silence tells git to fall through to its other helpers rather than fail.
  test("prints nothing when signed out", async () => {
    resolveSpy.mockResolvedValue(null);

    await run("get", PLUGIN_REQUEST);

    expect(written()).toBe("");
  });

  test.each([
    "protocol=https\nhost=github.com\n\n",
    "protocol=https\nhost=evil.example.com\n\n",
    "protocol=https\n\n",
  ])("stays silent for a request that is not ours (%p)", async (request) => {
    await run("get", request);

    expect(written()).toBe("");
    expect(resolveSpy).not.toHaveBeenCalled();
  });
});

describe("archgate credential erase", () => {
  test("clears stored credentials for the plugins host", async () => {
    await run("erase", PLUGIN_REQUEST);

    expect(clearSpy).toHaveBeenCalled();
  });

  test("leaves credentials alone for another host", async () => {
    await run("erase", "protocol=https\nhost=github.com\n\n");

    expect(clearSpy).not.toHaveBeenCalled();
  });
});

describe("archgate credential store", () => {
  test("consumes the request without touching stored credentials", async () => {
    await run("store", PLUGIN_REQUEST);

    expect(written()).toBe("");
    expect(clearSpy).not.toHaveBeenCalled();
    expect(resolveSpy).not.toHaveBeenCalled();
  });
});
