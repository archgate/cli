// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import {
  identityFromIdToken,
  isExpired,
  pollForTokens,
  refreshAccessToken,
  requestDeviceCode,
} from "../../src/helpers/logto-auth";
import { rejectionMessage } from "../test-utils";

const originalFetch = globalThis.fetch;

/** Queue of responses returned by the stubbed fetch, in order. */
let responses: Response[];

/** A `globalThis.fetch` stand-in carrying the `preconnect` member its type requires. */
function stubFetch(impl: () => Promise<Response>): typeof globalThis.fetch {
  return Object.assign(impl, {
    preconnect: () => {
      // Present only to satisfy the fetch type; no test calls it.
    },
  });
}

beforeEach(() => {
  responses = [];
  globalThis.fetch = stubFetch(
    mock(async (): Promise<Response> => {
      const next = responses.shift();
      if (!next) throw new Error("unexpected fetch call");
      return next;
    })
  );
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** A token endpoint error body in the shape Logto returns. */
function errorResponse(error: string): Response {
  return Response.json({ error }, { status: 400 });
}

describe("requestDeviceCode", () => {
  test("returns the user code and verification URI", async () => {
    responses.push(
      Response.json({
        device_code: "device-abc",
        user_code: "HZML-HXLB",
        verification_uri: "https://auth.archgate.dev/device",
        expires_in: 600,
      })
    );

    const code = await requestDeviceCode();

    expect(code.user_code).toBe("HZML-HXLB");
    expect(code.device_code).toBe("device-abc");
  });

  // Logto omits `interval`; RFC 8628 makes 5 seconds the default.
  test("defaults the poll interval when the server omits it", async () => {
    responses.push(
      Response.json({
        device_code: "device-abc",
        user_code: "HZML-HXLB",
        verification_uri: "https://auth.archgate.dev/device",
        expires_in: 600,
      })
    );

    expect((await requestDeviceCode()).interval).toBe(5);
  });

  test("reports a non-OK response as a user-facing error", async () => {
    responses.push(new Response("nope", { status: 503 }));

    expect(await rejectionMessage(requestDeviceCode())).toContain(
      "Could not start sign-in"
    );
  });
});

describe("pollForTokens", () => {
  test("keeps polling while authorization is pending", async () => {
    responses.push(
      errorResponse("authorization_pending"),
      Response.json({
        access_token: "ey.access",
        refresh_token: "refresh-abc",
        expires_in: 3600,
      })
    );

    const result = await pollForTokens("device-abc", 0, 60);

    expect(result.tokens.accessToken).toBe("ey.access");
    expect(result.tokens.refreshToken).toBe("refresh-abc");
  });

  test.each([
    ["access_denied", "Sign-in was denied."],
    ["expired_token", "The sign-in code expired."],
  ])("stops on %s", async (error, message) => {
    responses.push(errorResponse(error));

    expect(
      await rejectionMessage(pollForTokens("device-abc", 0, 60))
    ).toContain(message);
  });

  test("gives up once the device code lifetime elapses", async () => {
    expect(
      await rejectionMessage(pollForTokens("device-abc", 0, -1))
    ).toContain("The sign-in code expired.");
  });

  test("fails when the exchange returns no refresh token", async () => {
    responses.push(
      Response.json({ access_token: "ey.access", expires_in: 60 })
    );

    expect(
      await rejectionMessage(pollForTokens("device-abc", 0, 60))
    ).toContain("did not return a refresh token");
  });
});

describe("refreshAccessToken", () => {
  test("returns the rotated token pair", async () => {
    responses.push(
      Response.json({
        access_token: "ey.new",
        refresh_token: "refresh-new",
        expires_in: 3600,
      })
    );

    const tokens = await refreshAccessToken("refresh-old");

    expect(tokens.accessToken).toBe("ey.new");
    expect(tokens.refreshToken).toBe("refresh-new");
  });

  // Logto rotates refresh tokens, but a response without one must not discard
  // the token the caller already holds.
  test("keeps the existing refresh token when none is returned", async () => {
    responses.push(Response.json({ access_token: "ey.new", expires_in: 3600 }));

    expect((await refreshAccessToken("refresh-old")).refreshToken).toBe(
      "refresh-old"
    );
  });

  test("asks the user to sign in again when the grant is rejected", async () => {
    responses.push(errorResponse("invalid_grant"));

    expect(await rejectionMessage(refreshAccessToken("refresh-old"))).toContain(
      "Your session has expired"
    );
  });
});

describe("isExpired", () => {
  test.each([
    ["already past", -1_000, true],
    ["inside the renewal skew", 30_000, true],
    ["comfortably valid", 600_000, false],
  ])("%s", (_label, offsetMs, expected) => {
    expect(isExpired(Date.now() + offsetMs)).toBe(expected);
  });
});

describe("malformed provider responses", () => {
  test("rejects a device-code response that is not the expected shape", async () => {
    responses.push(Response.json({ nope: true }));

    expect(await rejectionMessage(requestDeviceCode())).toContain(
      "unexpected response"
    );
  });

  test("rejects a poll error body that is not the expected shape", async () => {
    responses.push(Response.json({ nope: true }, { status: 400 }));

    expect(
      await rejectionMessage(pollForTokens("device-abc", 0, 60))
    ).toContain("unexpected response");
  });

  test("backs off when the provider answers slow_down", async () => {
    responses.push(
      errorResponse("slow_down"),
      Response.json({
        access_token: "ey.access",
        refresh_token: "refresh-abc",
        expires_in: 3600,
      })
    );

    const result = await pollForTokens("device-abc", 0, 60);

    expect(result.tokens.accessToken).toBe("ey.access");
  });

  test("surfaces an unrecognised error with its description", async () => {
    responses.push(
      Response.json(
        { error: "invalid_client", error_description: "unknown client" },
        { status: 400 }
      )
    );

    expect(
      await rejectionMessage(pollForTokens("device-abc", 0, 60))
    ).toContain("unknown client");
  });

  test("falls back to the error code when no description is given", async () => {
    responses.push(Response.json({ error: "invalid_client" }, { status: 400 }));

    expect(
      await rejectionMessage(pollForTokens("device-abc", 0, 60))
    ).toContain("invalid_client");
  });

  // A proxy's HTML error page must not escape as a SyntaxError.
  test("treats a non-JSON success body as an unexpected response", async () => {
    responses.push(new Response("<html>gateway</html>", { status: 200 }));

    expect(
      await rejectionMessage(pollForTokens("device-abc", 0, 60))
    ).toContain("unexpected response");
  });

  test("rejects a refresh response that is not the expected shape", async () => {
    responses.push(Response.json({ nope: true }));

    expect(await rejectionMessage(refreshAccessToken("refresh-old"))).toContain(
      "unexpected response"
    );
  });
});

describe("identityFromIdToken", () => {
  test.each([
    [{ sub: "usr_1", username: "octocat" }, "octocat"],
    [{ sub: "usr_1", name: "Octo Cat" }, "Octo Cat"],
    [{ sub: "usr_1", email: "octo@example.com" }, "octo@example.com"],
    [{ sub: "usr_1" }, "usr_1"],
  ])("prefers the most specific claim in %o", (claims, expected) => {
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");

    expect(identityFromIdToken(`header.${payload}.sig`)).toBe(expected);
  });

  test.each([undefined, "", "not-a-jwt", "header.!!!notbase64!!!.sig"])(
    "falls back to a generic name for %p",
    (token) => {
      expect(identityFromIdToken(token)).toBe("archgate");
    }
  );
});
