// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// Covers the telemetry paths that only run behind a live PostHog client: the
// environment detectors, common event properties, the SDK fetch wrapper, and
// flush logging. `mock.module` is process-global and retroactive, so this fake
// PostHog also serves every later in-process `initTelemetry()` — safer than the
// real SDK, which could emit into the production project.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as repoModule from "../../src/helpers/repo";
import type { RepoContext } from "../../src/helpers/repo";
import * as sentryModule from "../../src/helpers/sentry";
import * as telemetryModule from "../../src/helpers/telemetry";
import { _resetConfigCache } from "../../src/helpers/telemetry-config";
import { restoreEnv } from "../test-utils";

// ---------------------------------------------------------------------------
// Fake PostHog SDK
// ---------------------------------------------------------------------------

interface CapturePayload {
  distinctId: string;
  event: string;
  properties: Record<string, unknown>;
}

/** Shape the telemetry fetch wrapper resolves to on both of its branches. */
interface WrappedResponse {
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

type PostHogFetch = (url: string, init?: unknown) => Promise<WrappedResponse>;

interface FakePostHogOptions {
  host?: string;
  flushAt?: number;
  flushInterval?: number;
  disableGeoip?: boolean;
  fetch?: PostHogFetch;
}

let constructorThrows = false;
let captureThrows = false;
let shutdownHangs = false;
const fakeClients: FakePostHog[] = [];

class FakePostHog {
  readonly options: FakePostHogOptions;
  readonly captures: CapturePayload[] = [];
  shutdownCount = 0;

  constructor(_apiKey: string, options: FakePostHogOptions) {
    if (constructorThrows) throw new Error("PostHog constructor failed");
    this.options = options;
    fakeClients.push(this);
  }

  capture(payload: CapturePayload): void {
    if (captureThrows) throw new Error("PostHog capture failed");
    this.captures.push(payload);
  }

  async shutdown(): Promise<void> {
    this.shutdownCount++;
    if (shutdownHangs) {
      await new Promise<void>(() => {
        // Never settles — the flush timeout is what resolves the race.
      });
    }
  }
}

void mock.module("posthog-node", () => ({ PostHog: FakePostHog }));

// ---------------------------------------------------------------------------
// Environment managed by this file
// ---------------------------------------------------------------------------

const MANAGED_ENV_KEYS = [
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "CIRCLECI",
  "TRAVIS",
  "BUILDKITE",
  "JENKINS_URL",
  "JENKINS_HOME",
  "BITBUCKET_BUILD_NUMBER",
  "TF_BUILD",
  "TEAMCITY_VERSION",
  "CODEBUILD_BUILD_ID",
  "SHELL",
  "PSModulePath",
  "ComSpec",
  "LANG",
  "HOME",
  "ARCHGATE_TELEMETRY",
  "NODE_ENV",
];

const FAKE_REPO: RepoContext = {
  isGit: true,
  host: "github",
  owner: "archgate",
  name: "cli",
  repoId: "0f1e2d3c4b5a6978",
  remoteUrl: "https://github.com/archgate/cli.git",
  defaultBranch: "main",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeClient(): FakePostHog {
  const client = fakeClients.at(-1);
  if (client === undefined) throw new Error("PostHog was never constructed");
  return client;
}

function fetchWrapper(): PostHogFetch {
  const wrapper = fakeClient().options.fetch;
  if (wrapper === undefined)
    throw new Error("PostHog options carried no fetch wrapper");
  return wrapper;
}

function lastProperties(): Record<string, unknown> {
  const last = fakeClient().captures.at(-1);
  if (last === undefined) throw new Error("no PostHog capture was recorded");
  return last.properties;
}

/** Initialize against the fake SDK, emit one event, read its properties. */
async function captureProperties(): Promise<Record<string, unknown>> {
  await telemetryModule.initTelemetry();
  telemetryModule.trackEvent("telemetry_events_probe");
  return lastProperties();
}

/** A `globalThis.fetch` stand-in carrying the `preconnect` member its type requires. */
function stubFetch(impl: () => Promise<Response>): typeof globalThis.fetch {
  return Object.assign(impl, {
    preconnect: () => {
      // Present only to satisfy the fetch type; no test calls it.
    },
  });
}

/** Redefine a member of a global namespace, keeping it configurable for restore. */
function overrideGlobal(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    writable: true,
    value,
  });
}

describe("telemetry events", () => {
  let tempDir: string;
  const savedEnv = new Map<string, string | undefined>();
  let sentrySpy: ReturnType<
    typeof spyOn<typeof sentryModule, "captureException">
  >;
  let repoSpy: ReturnType<typeof spyOn<typeof repoModule, "getRepoContext">>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-telemetry-events-"));
    for (const key of MANAGED_ENV_KEYS) {
      savedEnv.set(key, Bun.env[key]);
      delete Bun.env[key];
    }
    Bun.env.HOME = tempDir;
    // NODE_ENV is deliberately not "test": `isTestEnvironment()` otherwise
    // short-circuits `trackEvent` before any of these paths run. Safe only
    // because the PostHog SDK is faked — see the file header.
    Bun.env.NODE_ENV = "telemetry-events";

    constructorThrows = false;
    captureThrows = false;
    shutdownHangs = false;
    fakeClients.length = 0;

    repoSpy = spyOn(repoModule, "getRepoContext").mockResolvedValue(FAKE_REPO);
    sentrySpy = spyOn(sentryModule, "captureException").mockImplementation(
      () => {
        // Keep the real Sentry transport out of the test process.
      }
    );

    telemetryModule._resetTelemetry();
    _resetConfigCache();
  });

  afterEach(() => {
    telemetryModule._resetTelemetry();
    _resetConfigCache();
    mock.restore();
    for (const [key, value] of savedEnv) restoreEnv(key, value);
    savedEnv.clear();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("client construction", () => {
    test("configures the archgate proxy host and explicit flush settings", async () => {
      await telemetryModule.initTelemetry();

      const { options } = fakeClient();
      expect(options.host).toBe("https://n.archgate.dev");
      expect(options.disableGeoip).toBe(false);
      expect(options.flushAt).toBe(20);
      expect(options.flushInterval).toBe(0);
    });

    test("leaves the client null when the SDK constructor throws", async () => {
      constructorThrows = true;

      await telemetryModule.initTelemetry();

      expect(telemetryModule._getClient()).toBeNull();
      expect(() => {
        telemetryModule.trackEvent("never_captured");
      }).not.toThrow();
    });
  });

  describe("fetch wrapper", () => {
    const url = "https://n.archgate.dev/batch/";
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test("passes the real response through when the network is reachable", async () => {
      globalThis.fetch = stubFetch(
        async () => new Response("delegated", { status: 201 })
      );
      await telemetryModule.initTelemetry();

      const response = await fetchWrapper()(url, { method: "POST" });

      expect(response.status).toBe(201);
      expect(await response.text()).toBe("delegated");
      expect(sentrySpy).not.toHaveBeenCalled();
    });

    test("returns a synthetic 200 and reports to Sentry when fetch throws", async () => {
      const networkError = new Error("ECONNREFUSED");
      globalThis.fetch = stubFetch(() => {
        throw networkError;
      });
      await telemetryModule.initTelemetry();

      const response = await fetchWrapper()(url, { method: "POST" });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("ok");
      expect(await response.json()).toEqual({});
      expect(sentrySpy).toHaveBeenCalledWith(networkError, {
        source: "posthog-fetch",
        url,
      });
    });
  });

  describe("common event properties", () => {
    test("sends CLI and runtime identity with a null $ip", async () => {
      const props = await captureProperties();

      expect(props).toContainKeys([
        "cli_version",
        "os",
        "arch",
        "bun_version",
        "install_method",
        "is_tty",
        "is_wsl",
      ]);
      expect(props.bun_version).toBe(Bun.version);
      expect(props.arch).toBe(process.arch);
      expect(props.$ip).toBeNull();
    });

    test("counts the ADRs of the surrounding archgate project", async () => {
      const props = await captureProperties();

      expect(props.has_project).toBe(true);
      expect(props.adr_count).toBeGreaterThan(0);
      expect(props.adr_with_rules_count).toBeGreaterThan(0);
      expect(props.adr_domains_count).toBeGreaterThan(0);
    });

    test("carries the repo context resolved during init", async () => {
      const props = await captureProperties();

      expect(props.repo_is_git).toBe(true);
      expect(props.repo_host).toBe("github");
      expect(props.repo_id).toBe(FAKE_REPO.repoId);
      expect(props.git_default_branch).toBe("main");
      // Raw identity ships only on `project_initialized`, never per-event.
      expect(props).not.toContainKey("remote_url");
      expect(props).not.toContainKey("repo_owner");
      expect(props).not.toContainKey("repo_name");
    });

    test("nulls the repo fields when repo-context resolution rejects", async () => {
      repoSpy.mockRejectedValue(new Error("git is not installed"));

      const props = await captureProperties();

      expect(props.repo_is_git).toBe(false);
      expect(props.repo_host).toBeNull();
      expect(props.repo_id).toBeNull();
      expect(props.git_default_branch).toBeNull();
    });

    test("memoizes the static snapshot across events", async () => {
      const first = await captureProperties();
      Bun.env.GITLAB_CI = "true";
      telemetryModule.trackEvent("telemetry_events_probe_2");
      const second = lastProperties();

      expect(second.ci_provider).toBe(first.ci_provider);
      expect(fakeClient().captures).toHaveLength(2);
    });
  });

  describe("ci_provider detection", () => {
    test.each([
      {
        envKey: "GITHUB_ACTIONS",
        envValue: "true",
        expected: "github-actions",
      },
      { envKey: "GITLAB_CI", envValue: "true", expected: "gitlab-ci" },
      { envKey: "CIRCLECI", envValue: "true", expected: "circleci" },
      { envKey: "TRAVIS", envValue: "true", expected: "travis" },
      { envKey: "BUILDKITE", envValue: "true", expected: "buildkite" },
      { envKey: "JENKINS_URL", envValue: "http://ci", expected: "jenkins" },
      { envKey: "JENKINS_HOME", envValue: "/jenkins", expected: "jenkins" },
      {
        envKey: "BITBUCKET_BUILD_NUMBER",
        envValue: "42",
        expected: "bitbucket-pipelines",
      },
      { envKey: "TF_BUILD", envValue: "True", expected: "azure-pipelines" },
      { envKey: "TEAMCITY_VERSION", envValue: "2024.03", expected: "teamcity" },
      {
        envKey: "CODEBUILD_BUILD_ID",
        envValue: "build:1",
        expected: "aws-codebuild",
      },
      { envKey: "CI", envValue: "1", expected: "other" },
    ])(
      "classifies $envKey as $expected",
      async ({ envKey, envValue, expected }) => {
        Bun.env[envKey] = envValue;

        const props = await captureProperties();

        expect(props.ci_provider).toBe(expected);
      }
    );

    test("reports a null provider outside CI", async () => {
      const props = await captureProperties();

      expect(props.ci_provider).toBeNull();
      expect(props.is_ci).toBe(false);
    });

    test("reports is_ci true when CI is set", async () => {
      Bun.env.CI = "true";

      const props = await captureProperties();

      expect(props.is_ci).toBe(true);
    });

    test("ignores an empty CI variable", async () => {
      Bun.env.GITHUB_ACTIONS = "";

      const props = await captureProperties();

      expect(props.ci_provider).toBeNull();
    });
  });

  describe("shell detection", () => {
    test.each([
      { envKey: "SHELL", envValue: "/usr/bin/zsh", expected: "zsh" },
      {
        envKey: "PSModulePath",
        envValue: "/ps/Modules",
        expected: "powershell",
      },
      {
        envKey: "ComSpec",
        envValue: "/windows/system32/CMD.EXE",
        expected: "cmd.exe",
      },
    ])(
      "derives the shell from $envKey",
      async ({ envKey, envValue, expected }) => {
        Bun.env[envKey] = envValue;

        const props = await captureProperties();

        expect(props.shell).toBe(expected);
      }
    );

    test("reports a null shell when no shell variable is set", async () => {
      const props = await captureProperties();

      expect(props.shell).toBeNull();
    });
  });

  describe("locale detection", () => {
    let originalDateTimeFormat: typeof Intl.DateTimeFormat;

    beforeEach(() => {
      originalDateTimeFormat = Intl.DateTimeFormat;
    });

    afterEach(() => {
      overrideGlobal(Intl, "DateTimeFormat", originalDateTimeFormat);
    });

    function breakIntl(): void {
      overrideGlobal(Intl, "DateTimeFormat", () => {
        throw new Error("Intl unavailable");
      });
    }

    test("reports the resolved Intl locale", async () => {
      const props = await captureProperties();

      expect(props.locale).toBe(Intl.DateTimeFormat().resolvedOptions().locale);
    });

    test("falls back to LANG when Intl is unavailable", async () => {
      breakIntl();
      Bun.env.LANG = "pt_BR.UTF-8";

      const props = await captureProperties();

      expect(props.locale).toBe("pt_BR.UTF-8");
    });

    test("falls back to null when Intl is unavailable and LANG is unset", async () => {
      breakIntl();

      const props = await captureProperties();

      expect(props.locale).toBeNull();
    });
  });

  describe("trackEvent", () => {
    test("merges caller properties over the common ones", async () => {
      await telemetryModule.initTelemetry();
      telemetryModule.trackCommand("check", { json: true });

      const captured = fakeClient().captures.at(-1);
      expect(captured?.event).toBe("command_executed");
      expect(captured?.properties.command).toBe("check");
      expect(captured?.properties.json).toBe(true);
      expect(captured?.distinctId).toBeString();
    });

    test("swallows a capture failure", async () => {
      await telemetryModule.initTelemetry();
      captureThrows = true;

      expect(() => {
        telemetryModule.trackEvent("capture_explodes");
      }).not.toThrow();
    });
  });

  describe("flushTelemetry", () => {
    test("shuts the client down once", async () => {
      await telemetryModule.initTelemetry();
      const client = fakeClient();

      await telemetryModule.flushTelemetry();

      expect(client.shutdownCount).toBe(1);
    });

    test("resolves via the timeout when shutdown hangs", async () => {
      await telemetryModule.initTelemetry();
      shutdownHangs = true;

      await telemetryModule.flushTelemetry(10);

      expect(fakeClient().shutdownCount).toBe(1);
    });
  });
});
