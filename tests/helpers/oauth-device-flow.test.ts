// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { deviceFlowAuth } from "../../src/helpers/oauth-device-flow";
import type { DeviceAuthorization } from "../../src/helpers/platform-auth";
import {
  type RecordedRequest,
  recordingFetch,
  rejectionMessage,
} from "../test-utils";

const originalFetch = globalThis.fetch;

/** Queue of responses returned by the stubbed fetch, in order. */
let responses: Response[];

/** Every request the code under test sent, in order. */
let requests: RecordedRequest[];

const auth = deviceFlowAuth({
  deviceAuthorizationEndpoint: "https://sso.example.test/device",
  tokenEndpoint: "https://sso.example.test/token",
  clientId: "client-1",
  scope: "openid offline_access",
  resource: "https://api.example.test",
});

const PENDING: DeviceAuthorization = {
  deviceCode: "device-abc",
  userCode: "HZML-HXLB",
  verificationUri: "https://sso.example.test/activate",
  expiresIn: 60,
  interval: 0,
};

beforeEach(() => {
  responses = [];
  requests = [];
  globalThis.fetch = recordingFetch(requests, () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch call");
    return next;
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** A token endpoint error body. */
function errorResponse(error: string): Response {
  return Response.json({ error }, { status: 400 });
}

function deviceCodeResponse(extra: Record<string, unknown> = {}): Response {
  return Response.json({
    device_code: "device-abc",
    user_code: "HZML-HXLB",
    verification_uri: "https://sso.example.test/activate",
    expires_in: 600,
    ...extra,
  });
}

function grantResponse(extra: Record<string, unknown> = {}): Response {
  return Response.json({
    access_token: "ey.access",
    refresh_token: "refresh-abc",
    expires_in: 3600,
    ...extra,
  });
}

/** An ID token whose payload carries the given claims. */
function idTokenFor(claims: Record<string, string>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${payload}.sig`;
}

// A 307 or 308 would replay the body, which carries a device code or refresh
// token, to whatever host the `Location` header names.
describe("redirect policy", () => {
  test.each([
    [
      "requestDeviceCode",
      async () => auth.requestDeviceCode(),
      deviceCodeResponse,
    ],
    ["pollForTokens", async () => auth.pollForTokens(PENDING), grantResponse],
    [
      "refreshAccessToken",
      async () => auth.refreshAccessToken("refresh-old"),
      grantResponse,
    ],
  ])("%s refuses to follow redirects", async (_name, call, respond) => {
    responses.push(respond());

    await call();

    expect(requests[0]?.init?.redirect).toBe("error");
  });
});

describe("requestDeviceCode", () => {
  test("asks the configured endpoint as the configured client", async () => {
    responses.push(deviceCodeResponse());

    await auth.requestDeviceCode();

    expect(requests[0]?.url).toBe("https://sso.example.test/device");
    expect(Object.fromEntries(requests[0]?.fields ?? [])).toEqual({
      client_id: "client-1",
      scope: "openid offline_access",
      resource: "https://api.example.test",
    });
  });

  test("returns the codes and where to enter them", async () => {
    responses.push(
      deviceCodeResponse({
        verification_uri_complete:
          "https://sso.example.test/activate?user_code=HZML-HXLB",
        interval: 7,
      })
    );

    expect(await auth.requestDeviceCode()).toEqual({
      deviceCode: "device-abc",
      userCode: "HZML-HXLB",
      verificationUri: "https://sso.example.test/activate",
      verificationUriComplete:
        "https://sso.example.test/activate?user_code=HZML-HXLB",
      expiresIn: 600,
      interval: 7,
    });
  });

  // RFC 8628 makes 5 seconds the default when the server omits `interval`.
  test("defaults the poll interval when the server omits it", async () => {
    responses.push(deviceCodeResponse());

    expect((await auth.requestDeviceCode()).interval).toBe(5);
  });

  test("reports a non-OK response as a user-facing error", async () => {
    responses.push(new Response("nope", { status: 503 }));

    expect(await rejectionMessage(auth.requestDeviceCode())).toContain(
      "Could not start sign-in"
    );
  });

  test("rejects a response that is not the expected shape", async () => {
    responses.push(Response.json({ nope: true }));

    expect(await rejectionMessage(auth.requestDeviceCode())).toContain(
      "unexpected response"
    );
  });
});

describe("pollForTokens", () => {
  test("polls the token endpoint with the device grant", async () => {
    responses.push(grantResponse());

    await auth.pollForTokens(PENDING);

    expect(requests[0]?.url).toBe("https://sso.example.test/token");
    expect(Object.fromEntries(requests[0]?.fields ?? [])).toEqual({
      client_id: "client-1",
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: "device-abc",
    });
  });

  test("keeps polling while authorization is pending", async () => {
    responses.push(errorResponse("authorization_pending"), grantResponse());

    const session = await auth.pollForTokens(PENDING);

    expect(session.tokens.accessToken).toBe("ey.access");
    expect(session.tokens.refreshToken).toBe("refresh-abc");
    expect(requests).toHaveLength(2);
  });

  test("backs off by five seconds when the provider answers slow_down", async () => {
    const sleepSpy = spyOn(Bun, "sleep").mockResolvedValue();
    responses.push(errorResponse("slow_down"), grantResponse());
    try {
      expect((await auth.pollForTokens(PENDING)).tokens.accessToken).toBe(
        "ey.access"
      );
      expect(sleepSpy.mock.calls.map((call) => call[0])).toEqual([0, 5_000]);
    } finally {
      sleepSpy.mockRestore();
    }
  });

  test.each([
    ["access_denied", "Sign-in was denied."],
    ["expired_token", "The sign-in code expired."],
  ])("stops on %s", async (error, message) => {
    responses.push(errorResponse(error));

    expect(await rejectionMessage(auth.pollForTokens(PENDING))).toContain(
      message
    );
  });

  test("gives up once the device code lifetime elapses", async () => {
    expect(
      await rejectionMessage(auth.pollForTokens({ ...PENDING, expiresIn: -1 }))
    ).toContain("The sign-in code expired.");
  });

  test("fails when the grant carries no refresh token", async () => {
    responses.push(
      Response.json({ access_token: "ey.access", expires_in: 60 })
    );

    expect(await rejectionMessage(auth.pollForTokens(PENDING))).toContain(
      "did not return a refresh token"
    );
  });

  test("surfaces an unrecognised error with its description", async () => {
    responses.push(
      Response.json(
        { error: "invalid_client", error_description: "unknown client" },
        { status: 400 }
      )
    );

    expect(await rejectionMessage(auth.pollForTokens(PENDING))).toContain(
      "unknown client"
    );
  });

  test("falls back to the error code when no description is given", async () => {
    responses.push(errorResponse("invalid_client"));

    expect(await rejectionMessage(auth.pollForTokens(PENDING))).toContain(
      "invalid_client"
    );
  });

  test("rejects an error body that is not the expected shape", async () => {
    responses.push(Response.json({ nope: true }, { status: 400 }));

    expect(await rejectionMessage(auth.pollForTokens(PENDING))).toContain(
      "unexpected response"
    );
  });

  // A proxy's HTML error page must not escape as a SyntaxError.
  test("treats a non-JSON success body as an unexpected response", async () => {
    responses.push(new Response("<html>gateway</html>", { status: 200 }));

    expect(await rejectionMessage(auth.pollForTokens(PENDING))).toContain(
      "unexpected response"
    );
  });

  describe("names the session", () => {
    test.each([
      [{ sub: "usr_1", username: "octocat" }, "octocat"],
      [{ sub: "usr_1", name: "Octo Cat" }, "Octo Cat"],
      [{ sub: "usr_1", email: "octo@example.com" }, "octo@example.com"],
      [{ sub: "usr_1" }, "usr_1"],
    ])("from the most specific claim in %o", async (claims, expected) => {
      responses.push(grantResponse({ id_token: idTokenFor(claims) }));

      expect((await auth.pollForTokens(PENDING)).user).toBe(expected);
    });

    test.each([
      ["no ID token", undefined],
      ["an empty ID token", ""],
      ["a token that is not a JWT", "not-a-jwt"],
      ["a token with an empty payload", "header..sig"],
      ["a payload that is not base64", "header.!!!notbase64!!!.sig"],
      ["claims without a subject", idTokenFor({ name: "nobody" })],
    ])("generically given %s", async (_label, idToken) => {
      responses.push(grantResponse({ id_token: idToken }));

      expect((await auth.pollForTokens(PENDING)).user).toBe("archgate");
    });
  });
});

describe("refreshAccessToken", () => {
  test("sends the refresh grant for the configured resource", async () => {
    responses.push(grantResponse());

    await auth.refreshAccessToken("refresh-old");

    expect(requests[0]?.url).toBe("https://sso.example.test/token");
    expect(Object.fromEntries(requests[0]?.fields ?? [])).toEqual({
      client_id: "client-1",
      grant_type: "refresh_token",
      refresh_token: "refresh-old",
      resource: "https://api.example.test",
    });
  });

  test("returns the rotated token pair", async () => {
    responses.push(
      grantResponse({ access_token: "ey.new", refresh_token: "refresh-new" })
    );

    const tokens = await auth.refreshAccessToken("refresh-old");

    expect(tokens.accessToken).toBe("ey.new");
    expect(tokens.refreshToken).toBe("refresh-new");
  });

  // A grant without a rotated refresh token must not discard the one held.
  test("keeps the existing refresh token when none is returned", async () => {
    responses.push(Response.json({ access_token: "ey.new", expires_in: 3600 }));

    expect((await auth.refreshAccessToken("refresh-old")).refreshToken).toBe(
      "refresh-old"
    );
  });

  test("asks the user to sign in again when the grant is rejected", async () => {
    responses.push(errorResponse("invalid_grant"));

    expect(
      await rejectionMessage(auth.refreshAccessToken("refresh-old"))
    ).toContain("Your session has expired");
  });

  test("rejects a response that is not the expected shape", async () => {
    responses.push(Response.json({ nope: true }));

    expect(
      await rejectionMessage(auth.refreshAccessToken("refresh-old"))
    ).toContain("unexpected response");
  });
});
