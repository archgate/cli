// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";

import { logDebug, logInfo, logError, logWarn } from "../../src/helpers/log";

describe("log helpers", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let warnSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let traceSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    traceSpy = spyOn(console, "trace").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    traceSpy.mockRestore();
    delete process.env.DEBUG;
    delete process.env.TRACE;
  });

  describe("logInfo", () => {
    test("writes to console.log", () => {
      logInfo("hello");
      expect(logSpy).toHaveBeenCalledTimes(1);
    });

    test("includes the message argument", () => {
      logInfo("test message");
      const output = String(logSpy.mock.calls[0]);
      expect(output).toContain("test message");
    });
  });

  describe("logError", () => {
    test("writes to console.error", () => {
      logError("something failed");
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    test("includes the message argument", () => {
      logError("critical failure");
      const output = String(errorSpy.mock.calls[0]);
      expect(output).toContain("critical failure");
    });
  });

  describe("logWarn", () => {
    test("writes to console.warn", () => {
      logWarn("watch out");
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    test("includes the message argument", () => {
      logWarn("careful now");
      const output = String(warnSpy.mock.calls[0]);
      expect(output).toContain("careful now");
    });
  });

  describe("logDebug", () => {
    test("does not write when DEBUG is unset", () => {
      logDebug("hidden");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    test("writes to console.warn when DEBUG is set", () => {
      process.env.DEBUG = "1";
      logDebug("visible");
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    test("includes the message when DEBUG is set", () => {
      process.env.DEBUG = "1";
      logDebug("debug info");
      const output = String(warnSpy.mock.calls[0]);
      expect(output).toContain("debug info");
    });

    test("calls console.trace when TRACE is set", () => {
      process.env.TRACE = "1";
      logDebug("trace me");
      expect(traceSpy).toHaveBeenCalledTimes(1);
    });
  });
});
