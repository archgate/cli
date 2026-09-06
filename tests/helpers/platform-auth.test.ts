// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  AUTH_HOST,
  isExpired,
  platformAuth,
  PLUGINS_HOST,
} from "../../src/helpers/platform-auth";
import {
  type RecordedRequest,
  recordingFetch,
  rejectionMessage,
} from "../test-utils";

const originalFetch = globalThis.fetch;

/** URL and form fields of every request sent through the stubbed fetch. */
let requests: RecordedRequest[];

beforeEach(() => {
  requests = [];
  globalThis.fetch = recordingFetch(
    requests,
    () => new Response("unavailable", { status: 503 })
  );
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("platformAuth", () => {
  test("signs in against the platform's sign-in host", async () => {
    await rejectionMessage(platformAuth.requestDeviceCode());

    expect(new URL(requests[0]?.url ?? "").host).toBe(AUTH_HOST);
  });

  // The plugins backend validates the audience, so the access token must be
  // minted for its host or every download is rejected.
  test("requests tokens for the plugins host", async () => {
    await rejectionMessage(platformAuth.requestDeviceCode());

    expect(requests[0]?.fields.get("resource")).toBe(`https://${PLUGINS_HOST}`);
  });

  test("asks for a refresh token", async () => {
    await rejectionMessage(platformAuth.requestDeviceCode());

    expect(requests[0]?.fields.get("scope")).toContain("offline_access");
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
