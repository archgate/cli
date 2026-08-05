// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  mock,
  spyOn,
} from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getClient } from "@sentry/node-core/light";

import * as telemetryConfigMod from "../../src/helpers/telemetry-config";
import { restoreEnv } from "../test-utils";

describe("sentry", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let originalTelemetryEnv: string | undefined;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-sentry-test-"));
    originalHome = Bun.env.HOME;
    originalTelemetryEnv = Bun.env.ARCHGATE_TELEMETRY;
    originalNodeEnv = Bun.env.NODE_ENV;
    Bun.env.HOME = tempDir;
    Bun.env.NODE_ENV = "test";
    delete Bun.env.ARCHGATE_TELEMETRY;
  });

  afterEach(async () => {
    // restoreEnv deletes when the original was unset — a bare
    // `Bun.env.HOME = originalHome` assigns the string "undefined" and leaks it
    // into every later test file (Bun.env is process-global).
    restoreEnv("HOME", originalHome);
    restoreEnv("ARCHGATE_TELEMETRY", originalTelemetryEnv);
    restoreEnv("NODE_ENV", originalNodeEnv);
    rmSync(tempDir, { recursive: true, force: true });

    const { _resetSentry } = await import("../../src/helpers/sentry");
    _resetSentry();
    const { _resetConfigCache } =
      await import("../../src/helpers/telemetry-config");
    _resetConfigCache();
    mock.restore();
  });

  describe("initSentry", () => {
    test("initializes Sentry SDK when telemetry is enabled", async () => {
      const { initSentry } = await import("../../src/helpers/sentry");

      // Sentry.init is called internally — initialization must resolve cleanly.
      expect(initSentry()).resolves.toBeUndefined();
    });

    test("an init failure leaves the SDK unarmed instead of propagating", async () => {
      // The install ID is read while building the init options, inside the
      // try block — a failure there must be swallowed like any other.
      const installIdSpy = spyOn(
        telemetryConfigMod,
        "getInstallId"
      ).mockImplementation(() => {
        throw new Error("telemetry config unreadable");
      });
      try {
        const { initSentry, captureException } =
          await import("../../src/helpers/sentry");

        await initSentry();

        expect(installIdSpy).toHaveBeenCalled();
        // Nothing was armed, so later calls stay no-ops.
        expect(() => {
          captureException(new Error("after a failed init"));
        }).not.toThrow();
      } finally {
        installIdSpy.mockRestore();
      }
    });

    test("does not initialize when telemetry is disabled", async () => {
      Bun.env.ARCHGATE_TELEMETRY = "0";

      const { initSentry, captureException } =
        await import("../../src/helpers/sentry");

      await initSentry();
      // captureException should be a no-op when telemetry is disabled.
      expect(() => {
        captureException(new Error("should not send"));
      }).not.toThrow();
    });
  });

  describe("captureException", () => {
    test("is a no-op when not initialized", async () => {
      const { captureException } = await import("../../src/helpers/sentry");

      expect(() => {
        captureException(new Error("should not send"));
      }).not.toThrow();
    });

    test("handles non-Error values without throwing", async () => {
      const { initSentry, captureException } =
        await import("../../src/helpers/sentry");

      await initSentry();
      expect(() => {
        captureException("string error", { command: "init" });
      }).not.toThrow();
    });
  });

  describe("addBreadcrumb", () => {
    test("is a no-op when not initialized", async () => {
      const { addBreadcrumb } = await import("../../src/helpers/sentry");

      expect(() => {
        addBreadcrumb("test", "test breadcrumb");
      }).not.toThrow();
    });

    test("adds breadcrumb when initialized", async () => {
      const { initSentry, addBreadcrumb } =
        await import("../../src/helpers/sentry");

      await initSentry();
      expect(() => {
        addBreadcrumb("command", "Running: check", { staged: true });
      }).not.toThrow();
    });
  });

  describe("SDK-level failures", () => {
    /**
     * The live client after a successful init. Reading it back is the only
     * way to reach the options archgate handed the SDK, and its methods are
     * own-property assignable, so a failing transport can be simulated
     * without mocking the module (which would leak process-wide).
     */
    async function initAndGetClient() {
      const { initSentry } = await import("../../src/helpers/sentry");
      await initSentry();
      const client = getClient();
      expect(client).toBeDefined();
      if (!client) throw new TypeError("Sentry client was not created");
      return client;
    }

    test.each([
      ["the inquirer ExitPromptError type", { type: "ExitPromptError" }],
      [
        "a SIGINT prompt-cancellation message",
        { value: "User force closed the prompt with SIGINT" },
      ],
    ])("beforeSend drops %s", async (_label, exceptionValue) => {
      const client = await initAndGetClient();
      const { beforeSend } = client.getOptions();

      expect(
        beforeSend?.(
          // `type: undefined` is ErrorEvent's discriminant against
          // transaction events.
          { type: undefined, exception: { values: [exceptionValue] } },
          {}
        )
      ).toBeNull();
    });

    test("beforeSend passes a genuine crash through untouched", async () => {
      const client = await initAndGetClient();
      const { beforeSend } = client.getOptions();
      const event = {
        type: undefined,
        exception: { values: [{ type: "TypeError", value: "boom" }] },
      };

      expect(beforeSend?.(event, {})).toBe(event);
      // An event with no exception at all also survives.
      expect(
        beforeSend?.({ type: undefined, message: "just a log" }, {})
      ).toEqual({ type: undefined, message: "just a log" });
    });

    test("captureException swallows a failing client", async () => {
      const client = await initAndGetClient();
      const original = client.captureException.bind(client);
      const { captureException } = await import("../../src/helpers/sentry");
      let captureCalls = 0;
      try {
        client.captureException = () => {
          captureCalls++;
          throw new Error("transport exploded");
        };

        expect(() => {
          captureException(new Error("boom"), { command: "check" });
        }).not.toThrow();
        expect(captureCalls).toBe(1);
      } finally {
        client.captureException = original;
      }
    });

    test("flushSentry swallows a failing client", async () => {
      const client = await initAndGetClient();
      const original = client.flush.bind(client);
      const { flushSentry } = await import("../../src/helpers/sentry");
      let flushCalls = 0;
      try {
        client.flush = () => {
          flushCalls++;
          throw new Error("flush exploded");
        };

        // A propagated failure would reject here and fail the test.
        await flushSentry(50);

        expect(flushCalls).toBe(1);
      } finally {
        client.flush = original;
      }
    });
  });

  describe("flushSentry", () => {
    test("is a no-op when not initialized", async () => {
      const { flushSentry } = await import("../../src/helpers/sentry");

      expect(flushSentry()).resolves.toBeUndefined();
    });

    test("flushes when initialized", async () => {
      const { initSentry, flushSentry } =
        await import("../../src/helpers/sentry");

      await initSentry();
      expect(flushSentry(100)).resolves.toBeUndefined();
    });
  });
});
