// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import packageJson from "../../package.json";
import { getPlatformInfo } from "../../src/helpers/platform";
import {
  USER_AGENT,
  fetchWithUserAgent,
  gitUserAgentEnv,
} from "../../src/helpers/user-agent";
import { type RecordedRequest, recordingFetch } from "../test-utils";

const originalFetch = globalThis.fetch;
let requests: RecordedRequest[];

beforeEach(() => {
  requests = [];
  globalThis.fetch = recordingFetch(requests, () => new Response("ok"));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** The `User-Agent` the recorded call carried, however the caller shaped its headers. */
function sentUserAgent(index = 0): string | null {
  return new Headers(requests[index]?.init?.headers).get("User-Agent");
}

describe("USER_AGENT", () => {
  test("names the product, the package version, the platform and the arch", () => {
    expect(USER_AGENT).toBe(
      `archgate-cli/${packageJson.version} (${getPlatformInfo().runtime}; ${process.arch})`
    );
  });

  test("is a single header-safe line", () => {
    expect(USER_AGENT).not.toMatch(/[\r\n]/u);
    expect(USER_AGENT).toMatch(/^archgate-cli\/\d+\.\d+\.\d+/u);
  });
});

describe("fetchWithUserAgent", () => {
  test("adds the User-Agent when the caller sent no headers", async () => {
    await fetchWithUserAgent("https://example.test/a");
    expect(requests[0]?.url).toBe("https://example.test/a");
    expect(sentUserAgent()).toBe(USER_AGENT);
  });

  test.each([
    ["a plain object", { Authorization: "Bearer t" }],
    ["a Headers instance", new Headers({ Authorization: "Bearer t" })],
    ["an entries array", [["Authorization", "Bearer t"]] as [string, string][]],
  ])("keeps the caller's headers given as %s", async (_label, headers) => {
    await fetchWithUserAgent("https://example.test/b", { headers });
    const sent = new Headers(requests[0]?.init?.headers);
    expect(sent.get("Authorization")).toBe("Bearer t");
    expect(sent.get("User-Agent")).toBe(USER_AGENT);
  });

  test("does not override a User-Agent the caller chose", async () => {
    await fetchWithUserAgent("https://example.test/c", {
      headers: { "user-agent": "custom/1" },
    });
    expect(sentUserAgent()).toBe("custom/1");
  });

  test("passes the rest of the init through untouched", async () => {
    const signal = AbortSignal.timeout(10_000);
    await fetchWithUserAgent("https://example.test/d", {
      method: "POST",
      body: new URLSearchParams({ k: "v" }),
      redirect: "error",
      signal,
    });
    const init = requests[0]?.init;
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBe(signal);
    expect(requests[0]?.fields.get("k")).toBe("v");
  });

  test("accepts a URL object", async () => {
    await fetchWithUserAgent(new URL("https://example.test/e?x=1"));
    expect(requests[0]?.url).toBe("https://example.test/e?x=1");
    expect(sentUserAgent()).toBe(USER_AGENT);
  });
});

describe("gitUserAgentEnv", () => {
  test("sets GIT_HTTP_USER_AGENT on top of the given environment", () => {
    const env = gitUserAgentEnv({ PATH: "/bin", HOME: "/h" });
    expect(env).toEqual({
      PATH: "/bin",
      HOME: "/h",
      GIT_HTTP_USER_AGENT: USER_AGENT,
    });
  });

  test("replaces a GIT_HTTP_USER_AGENT already present", () => {
    const env = gitUserAgentEnv({ GIT_HTTP_USER_AGENT: "other/0" });
    expect(env.GIT_HTTP_USER_AGENT).toBe(USER_AGENT);
  });

  test("defaults to the process environment without mutating it", () => {
    const before = Bun.env.GIT_HTTP_USER_AGENT;
    const env = gitUserAgentEnv();
    expect(env.PATH).toBe(Bun.env.PATH);
    expect(env.GIT_HTTP_USER_AGENT).toBe(USER_AGENT);
    expect(Bun.env.GIT_HTTP_USER_AGENT).toBe(before);
  });
});
