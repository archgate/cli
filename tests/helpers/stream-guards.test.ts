// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import * as exitMod from "../../src/helpers/exit";
import {
  handleStderrError,
  handleStdoutError,
  installStreamErrorGuards,
  _setBrokenPipeExit,
} from "../../src/helpers/stream-guards";

function makeEpipeError(): NodeJS.ErrnoException {
  return Object.assign(new Error("EPIPE: broken pipe, write"), {
    code: "EPIPE",
    errno: -32,
    syscall: "write",
  });
}

describe("stream-guards", () => {
  let exitCalls: number;

  beforeEach(() => {
    exitCalls = 0;
    _setBrokenPipeExit(() => {
      exitCalls++;
    });
  });

  afterEach(() => {
    _setBrokenPipeExit(null);
  });

  describe("handleStdoutError", () => {
    test("EPIPE triggers the broken-pipe exit action", () => {
      handleStdoutError(makeEpipeError());
      expect(exitCalls).toBe(1);
    });

    test("re-emitted EPIPE while exiting does not double-fire", () => {
      // Bun re-emits EPIPE on every write attempt; only the first event
      // may trigger the (async) exit path.
      handleStdoutError(makeEpipeError());
      handleStdoutError(makeEpipeError());
      handleStdoutError(makeEpipeError());
      expect(exitCalls).toBe(1);
    });

    test("non-EPIPE errors are rethrown without exiting", () => {
      const err = Object.assign(new Error("EACCES: permission denied"), {
        code: "EACCES",
      });
      expect(() => {
        handleStdoutError(err);
      }).toThrow("EACCES: permission denied");
      expect(exitCalls).toBe(0);
    });

    test("non-Error values are rethrown", () => {
      expect(() => {
        handleStdoutError("not an error");
      }).toThrow();
      expect(exitCalls).toBe(0);
    });
  });

  describe("handleStderrError", () => {
    test("EPIPE is swallowed without exiting", () => {
      expect(() => {
        handleStderrError(makeEpipeError());
      }).not.toThrow();
      expect(exitCalls).toBe(0);
    });

    test("non-EPIPE errors are rethrown", () => {
      const err = Object.assign(new Error("boom"), { code: "EIO" });
      expect(() => {
        handleStderrError(err);
      }).toThrow("boom");
    });
  });

  describe("the default exit action", () => {
    test("routes an unreplaced stdout EPIPE through exitForBrokenPipe", () => {
      // Never settles: the production action fires and forgets, and a
      // resolving stub would let the real exit path run under the test.
      const exitSpy = spyOn(exitMod, "exitForBrokenPipe").mockImplementation(
        async () => new Promise<never>(() => {})
      );
      try {
        // Drop the per-test stub so the shipped action is what runs.
        _setBrokenPipeExit(null);

        handleStdoutError(makeEpipeError());

        expect(exitSpy).toHaveBeenCalledTimes(1);
      } finally {
        exitSpy.mockRestore();
      }
    });
  });

  describe("installStreamErrorGuards", () => {
    test("attaches the handlers as error listeners on both streams", () => {
      installStreamErrorGuards();
      try {
        expect(process.stdout.listeners("error")).toContain(handleStdoutError);
        expect(process.stderr.listeners("error")).toContain(handleStderrError);
      } finally {
        process.stdout.removeListener("error", handleStdoutError);
        process.stderr.removeListener("error", handleStderrError);
      }
    });
  });
});
