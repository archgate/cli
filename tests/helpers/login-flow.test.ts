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

import * as credMod from "../../src/helpers/credential-store";
import * as gitConfigMod from "../../src/helpers/git-credential-config";
import { runLoginFlow } from "../../src/helpers/login-flow";
import * as logtoMod from "../../src/helpers/logto-auth";
import { rejectionMessage } from "../test-utils";

// Stubs are installed per-test via spyOn, which is auto-restored and scoped to
// this file; mock.module is process-global and would leak into sibling suites.
let mockRequestDeviceCode: Mock<typeof logtoMod.requestDeviceCode>;
let mockPollForTokens: Mock<typeof logtoMod.pollForTokens>;
let mockSaveTokenSet: Mock<typeof credMod.saveTokenSet>;
let mockRegisterHelper: Mock<typeof gitConfigMod.registerGitCredentialHelper>;
let logSpy: Mock<typeof console.log>;

const DEVICE_CODE = {
  device_code: "device-abc",
  user_code: "HZML-HXLB",
  verification_uri: "https://auth.archgate.dev/device",
  expires_in: 600,
  interval: 5,
};

const TOKENS = {
  accessToken: "ey.access.token",
  refreshToken: "refresh-abc",
  expiresAt: 1_800_000_000_000,
};

/** An ID token whose payload carries the given claims. */
function idTokenFor(claims: Record<string, string>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${payload}.signature`;
}

beforeEach(() => {
  mockRequestDeviceCode = spyOn(
    logtoMod,
    "requestDeviceCode"
  ).mockResolvedValue(DEVICE_CODE);
  mockPollForTokens = spyOn(logtoMod, "pollForTokens").mockResolvedValue({
    tokens: TOKENS,
    idToken: idTokenFor({ sub: "usr_1", username: "octocat" }),
  });
  mockSaveTokenSet = spyOn(credMod, "saveTokenSet").mockResolvedValue(true);
  mockRegisterHelper = spyOn(
    gitConfigMod,
    "registerGitCredentialHelper"
  ).mockResolvedValue(true);
  logSpy = spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  mockRequestDeviceCode.mockRestore();
  mockPollForTokens.mockRestore();
  mockSaveTokenSet.mockRestore();
  mockRegisterHelper.mockRestore();
  logSpy.mockRestore();
});

describe("runLoginFlow", () => {
  test("stores the token set under the signed-in identity", async () => {
    const result = await runLoginFlow();

    expect(result).toEqual({ ok: true, githubUser: "octocat" });
    expect(mockSaveTokenSet).toHaveBeenCalledWith("octocat", TOKENS);
  });

  test("shows the verification URI and user code", async () => {
    await runLoginFlow();

    const printed = logSpy.mock.calls.flat().join("\n");
    expect(printed).toContain("https://auth.archgate.dev/device");
    expect(printed).toContain("HZML-HXLB");
  });

  test("polls with the device code and server-supplied interval", async () => {
    await runLoginFlow();

    expect(mockPollForTokens).toHaveBeenCalledWith("device-abc", 5, 600);
  });

  test("registers archgate as git's credential helper", async () => {
    await runLoginFlow();

    expect(mockRegisterHelper).toHaveBeenCalled();
  });

  // Downloads use the Bearer token directly, so a failed git config write must
  // not fail the login — only clones lose their non-interactive credentials.
  test("still succeeds when the git config write fails", async () => {
    mockRegisterHelper.mockResolvedValue(false);

    const result = await runLoginFlow();

    expect(result.ok).toBe(true);
    expect(mockSaveTokenSet).toHaveBeenCalled();
  });

  test.each([
    [{ sub: "usr_1", username: "octocat" }, "octocat"],
    [{ sub: "usr_1", name: "Octo Cat" }, "Octo Cat"],
    [{ sub: "usr_1", email: "octo@example.com" }, "octo@example.com"],
    [{ sub: "usr_1" }, "usr_1"],
  ])("names the account from %o", async (claims, expected) => {
    mockPollForTokens.mockResolvedValue({
      tokens: TOKENS,
      idToken: idTokenFor(claims),
    });

    const result = await runLoginFlow();

    expect(result.githubUser).toBe(expected);
  });

  test("falls back to a generic name when no ID token is returned", async () => {
    mockPollForTokens.mockResolvedValue({ tokens: TOKENS, idToken: undefined });

    const result = await runLoginFlow();

    expect(result.githubUser).toBe("archgate");
  });

  test("fails the login when the token set cannot be persisted", async () => {
    mockSaveTokenSet.mockResolvedValue(false);

    expect(await rejectionMessage(runLoginFlow())).toContain(
      "credentials could not be stored"
    );
  });

  test("propagates a failure from the device authorization request", async () => {
    mockRequestDeviceCode.mockRejectedValue(new Error("network down"));

    expect(await rejectionMessage(runLoginFlow())).toContain("network down");
    expect(mockSaveTokenSet).not.toHaveBeenCalled();
  });
});
