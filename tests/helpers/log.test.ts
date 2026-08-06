// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  spyOn,
  type Mock,
} from "bun:test";

import {
  logDebug,
  logInfo,
  logError,
  logWarn,
  setLogLevel,
} from "../../src/helpers/log";
import { restoreEnv } from "../test-utils";

describe("log helpers", () => {
  let logSpy: Mock<typeof console.log>;
  let warnSpy: Mock<typeof console.warn>;
  let errorSpy: Mock<typeof console.error>;
  let traceSpy: Mock<typeof console.trace>;

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

describe("setLogLevel", () => {
  let originalDebug: string | undefined;
  let logSpy: Mock<typeof console.log>;
  let warnSpy: Mock<typeof console.warn>;

  beforeEach(() => {
    originalDebug = Bun.env.DEBUG;
    delete Bun.env.DEBUG;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    // The active level is module state shared with every later test file, so
    // put it back to the "info" default before restoring DEBUG.
    setLogLevel("info");
    restoreEnv("DEBUG", originalDebug);
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test("raising the level to debug makes logDebug write", () => {
    setLogLevel("debug");
    logDebug("now visible");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test("the debug level exports DEBUG so subprocesses inherit it", () => {
    setLogLevel("debug");
    expect(Bun.env.DEBUG).toBe("1");
  });

  test.each([
    ["error", 0, 0],
    ["warn", 0, 1],
    ["info", 1, 1],
  ] as const)(
    "level %s allows %d info and %d warn writes",
    (level, infoWrites, warnWrites) => {
      setLogLevel(level);

      logInfo("info line");
      logWarn("warn line");

      expect(logSpy).toHaveBeenCalledTimes(infoWrites);
      expect(warnSpy).toHaveBeenCalledTimes(warnWrites);
    }
  );

  test("errors are written regardless of the level", () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      setLogLevel("error");
      logError("always shown");
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
