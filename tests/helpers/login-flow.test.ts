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
import * as desktopMod from "../../src/helpers/desktop";
import * as gitConfigMod from "../../src/helpers/git-credential-config";
import { runLoginFlow } from "../../src/helpers/login-flow";
import { platformAuth } from "../../src/helpers/platform-auth";
import { rejectionMessage } from "../test-utils";

// Stubs are installed per-test via spyOn, which is auto-restored and scoped to
// this file; mock.module is process-global and would leak into sibling suites.
let mockRequestDeviceCode: Mock<typeof platformAuth.requestDeviceCode>;
let mockPollForTokens: Mock<typeof platformAuth.pollForTokens>;
let mockSaveTokenSet: Mock<typeof credMod.saveTokenSet>;
let mockRegisterHelper: Mock<typeof gitConfigMod.registerGitCredentialHelper>;
let mockOpenBrowser: Mock<typeof desktopMod.openBrowser>;
let mockCopyToClipboard: Mock<typeof desktopMod.copyToClipboard>;
let logSpy: Mock<typeof console.log>;

const AUTHORIZATION = {
  deviceCode: "device-abc",
  userCode: "HZML-HXLB",
  verificationUri: "https://auth.archgate.dev/device",
  expiresIn: 600,
  interval: 5,
};

const TOKENS = {
  accessToken: "ey.access.token",
  refreshToken: "refresh-abc",
  expiresAt: 1_800_000_000_000,
};

beforeEach(() => {
  mockRequestDeviceCode = spyOn(
    platformAuth,
    "requestDeviceCode"
  ).mockResolvedValue(AUTHORIZATION);
  mockPollForTokens = spyOn(platformAuth, "pollForTokens").mockResolvedValue({
    user: "octocat",
    tokens: TOKENS,
  });
  mockSaveTokenSet = spyOn(credMod, "saveTokenSet").mockResolvedValue(true);
  mockRegisterHelper = spyOn(
    gitConfigMod,
    "registerGitCredentialHelper"
  ).mockResolvedValue(true);
  mockOpenBrowser = spyOn(desktopMod, "openBrowser").mockResolvedValue(false);
  mockCopyToClipboard = spyOn(desktopMod, "copyToClipboard").mockResolvedValue(
    false
  );
  logSpy = spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  mockRequestDeviceCode.mockRestore();
  mockPollForTokens.mockRestore();
  mockSaveTokenSet.mockRestore();
  mockRegisterHelper.mockRestore();
  mockOpenBrowser.mockRestore();
  mockCopyToClipboard.mockRestore();
  logSpy.mockRestore();
});

describe("runLoginFlow", () => {
  test("stores the token set under the signed-in identity", async () => {
    const result = await runLoginFlow();

    expect(result).toEqual({ ok: true, accountName: "octocat" });
    expect(mockSaveTokenSet).toHaveBeenCalledWith("octocat", TOKENS);
  });

  test("shows the verification URI and user code", async () => {
    await runLoginFlow();

    const printed = logSpy.mock.calls.flat().join("\n");
    expect(printed).toContain("https://auth.archgate.dev/device");
    expect(printed).toContain("HZML-HXLB");
  });

  test("polls the pending authorization it was handed", async () => {
    await runLoginFlow();

    expect(mockPollForTokens).toHaveBeenCalledWith(AUTHORIZATION);
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

  test("reports the account name the platform resolved", async () => {
    mockPollForTokens.mockResolvedValue({ user: "Octo Cat", tokens: TOKENS });

    const result = await runLoginFlow();

    expect(result.accountName).toBe("Octo Cat");
  });

  test("fails the login when the token set cannot be persisted", async () => {
    mockSaveTokenSet.mockResolvedValue(false);

    expect(await rejectionMessage(runLoginFlow())).toContain(
      "credentials could not be stored"
    );
  });

  test("opens the URL that already carries the code", async () => {
    mockRequestDeviceCode.mockResolvedValue({
      ...AUTHORIZATION,
      verificationUriComplete:
        "https://auth.archgate.dev/device?user_code=HZML-HXLB",
    });

    await runLoginFlow();

    expect(mockOpenBrowser).toHaveBeenCalledWith(
      "https://auth.archgate.dev/device?user_code=HZML-HXLB"
    );
  });

  test("falls back to the plain URL when the provider omits the complete one", async () => {
    await runLoginFlow();

    expect(mockOpenBrowser).toHaveBeenCalledWith(
      "https://auth.archgate.dev/device"
    );
  });

  test("copies the user code to the clipboard", async () => {
    await runLoginFlow();

    expect(mockCopyToClipboard).toHaveBeenCalledWith("HZML-HXLB");
  });

  // The URL and code are printed either way: the browser may not have opened,
  // and the user may be reading this on a different machine.
  test.each([true, false])(
    "prints the URL and code when opened=%p",
    async (opened) => {
      mockOpenBrowser.mockResolvedValue(opened);

      await runLoginFlow();

      const printed = logSpy.mock.calls.flat().join("\n");
      expect(printed).toContain("https://auth.archgate.dev/device");
      expect(printed).toContain("HZML-HXLB");
    }
  );

  test("mentions the clipboard only when the copy succeeded", async () => {
    mockCopyToClipboard.mockResolvedValue(true);

    await runLoginFlow();

    expect(logSpy.mock.calls.flat().join("\n")).toContain(
      "copied to your clipboard"
    );
  });

  test("says nothing about the clipboard when the copy failed", async () => {
    await runLoginFlow();

    expect(logSpy.mock.calls.flat().join("\n")).not.toContain("clipboard");
  });

  test("propagates a failure from the device authorization request", async () => {
    mockRequestDeviceCode.mockRejectedValue(new Error("network down"));

    expect(await rejectionMessage(runLoginFlow())).toContain("network down");
    expect(mockSaveTokenSet).not.toHaveBeenCalled();
  });
});
