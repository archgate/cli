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
  beginCommand,
  classifyErrorKind,
  exitForBrokenPipe,
  exitWith,
  finalizeCommand,
  isEpipeError,
  _getExitState,
  _resetExitState,
} from "../../src/helpers/exit";
import * as telemetryMod from "../../src/helpers/telemetry";
import { UserError } from "../../src/helpers/user-error";
import { rejectionMessage, restoreEnv } from "../test-utils";

describe("exit helper", () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    _resetExitState();
  });

  afterEach(() => {
    restoreEnv("NODE_ENV", originalNodeEnv);
    _resetExitState();
  });

  describe("beginCommand", () => {
    test("stashes the command name and start time", () => {
      beginCommand("adr create");
      const state = _getExitState();
      expect(state.currentCommand).toBe("adr create");
      expect(state.commandStartTime).not.toBeNull();
      expect(state.completionTracked).toBe(false);
    });

    test("resets completion guard across consecutive invocations", () => {
      beginCommand("adr create");
      finalizeCommand("adr create", 0, "success");
      expect(_getExitState().completionTracked).toBe(true);

      beginCommand("check");
      expect(_getExitState().completionTracked).toBe(false);
      expect(_getExitState().currentCommand).toBe("check");
    });
  });

  describe("finalizeCommand", () => {
    test("flips the completion guard once", () => {
      beginCommand("check");
      finalizeCommand("check", 0, "success");
      expect(_getExitState().completionTracked).toBe(true);

      // Second call is a no-op — no way to assert "didn't send" without a mock,
      // but we at least verify the guard stays true.
      finalizeCommand("check", 0, "success");
      expect(_getExitState().completionTracked).toBe(true);
    });

    test("does not throw when called before beginCommand", () => {
      // The Commander postAction hook could race beginCommand if Commander
      // ever changes its lifecycle — finalizeCommand must degrade gracefully.
      expect(() => {
        finalizeCommand("", 0, "success");
      }).not.toThrow();
    });
  });

  describe("isEpipeError", () => {
    test("matches an errno-style EPIPE write error", () => {
      const err = Object.assign(new Error("EPIPE: broken pipe, write"), {
        code: "EPIPE",
        errno: -32,
        syscall: "write",
      });
      expect(isEpipeError(err)).toBe(true);
    });

    test("rejects errors with other codes", () => {
      const err = Object.assign(new Error("EACCES: permission denied"), {
        code: "EACCES",
      });
      expect(isEpipeError(err)).toBe(false);
    });

    test("rejects errors without a code and non-Error values", () => {
      expect(isEpipeError(new Error("EPIPE: broken pipe, write"))).toBe(false);
      expect(isEpipeError("EPIPE")).toBe(false);
      expect(isEpipeError(null)).toBe(false);
    });
  });

  describe("classifyErrorKind", () => {
    test("returns 'unknown' for non-Error values", () => {
      expect(classifyErrorKind("string error")).toBe("unknown");
      expect(classifyErrorKind(42)).toBe("unknown");
      expect(classifyErrorKind(null)).toBe("unknown");
    });

    test("classifies network errors", () => {
      expect(classifyErrorKind(new Error("ECONNREFUSED"))).toBe("network");
      expect(classifyErrorKind(new Error("ENOTFOUND some.host"))).toBe(
        "network"
      );
      expect(classifyErrorKind(new Error("ETIMEDOUT"))).toBe("network");
      expect(classifyErrorKind(new Error("EAI_AGAIN"))).toBe("network");
    });

    test("classifies TLS errors", () => {
      expect(classifyErrorKind(new Error("certificate has expired"))).toBe(
        "tls"
      );
      expect(classifyErrorKind(new Error("SELF_SIGNED_CERT"))).toBe("tls");
      expect(classifyErrorKind(new Error("UNABLE_TO_VERIFY"))).toBe("tls");
    });

    test("classifies permission errors", () => {
      expect(classifyErrorKind(new Error("EACCES: permission denied"))).toBe(
        "permission"
      );
      expect(
        classifyErrorKind(new Error("EPERM: operation not permitted"))
      ).toBe("permission");
    });

    test("classifies SyntaxError and TypeError by name", () => {
      expect(classifyErrorKind(new SyntaxError("unexpected token"))).toBe(
        "syntax"
      );
      expect(
        classifyErrorKind(new TypeError("undefined is not a function"))
      ).toBe("type");
    });

    test("classifies UserError", () => {
      expect(classifyErrorKind(new UserError("invalid input"))).toBe("user");
    });

    test("falls back to error name for unrecognized errors", () => {
      expect(classifyErrorKind(new RangeError("out of range"))).toBe(
        "RangeError"
      );
    });
  });

  describe("exitWith", () => {
    let exitSpy: Mock<typeof process.exit>;
    let trackSpy: Mock<typeof telemetryMod.trackCommandResult>;

    beforeEach(() => {
      // Throwing instead of exiting lets the test observe the requested code
      // without tearing down the test runner.
      exitSpy = spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      trackSpy = spyOn(telemetryMod, "trackCommandResult").mockImplementation(
        () => {}
      );
    });

    afterEach(() => {
      exitSpy.mockRestore();
      trackSpy.mockRestore();
    });

    test.each([
      [0, "success"],
      [1, "user_error"],
      [2, "internal_error"],
      [130, "cancelled"],
    ] as const)("code %d maps to the %s outcome", async (code, outcome) => {
      beginCommand("check");

      expect(await rejectionMessage(exitWith(code))).toBe("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(code);
      expect(trackSpy).toHaveBeenCalledTimes(1);
      expect(trackSpy.mock.calls[0][0]).toBe("check");
      expect(trackSpy.mock.calls[0][1]).toBe(code);
      expect(trackSpy.mock.calls[0][3]).toMatchObject({
        outcome,
        error_kind: null,
      });
    });

    test("an explicit outcome overrides the code-derived default", async () => {
      beginCommand("check");

      expect(
        await rejectionMessage(
          exitWith(1, { outcome: "cancelled", errorKind: "user_abort" })
        )
      ).toBe("process.exit");
      expect(trackSpy.mock.calls[0][3]).toMatchObject({
        outcome: "cancelled",
        error_kind: "user_abort",
      });
    });

    test("falls back to the 'root' command name when none was begun", async () => {
      expect(await rejectionMessage(exitWith(0))).toBe("process.exit");
      // beginCommand was never called, so exitWith names the invocation
      // "root" and finalizeCommand resolves it to "unknown".
      expect(trackSpy.mock.calls[0][0]).toBe("root");
    });
  });

  describe("exitForBrokenPipe", () => {
    test("exits 0 and tags the completion as a cancelled broken pipe", async () => {
      const exitSpy = spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      const trackSpy = spyOn(
        telemetryMod,
        "trackCommandResult"
      ).mockImplementation(() => {});
      try {
        beginCommand("adr list");

        expect(await rejectionMessage(exitForBrokenPipe())).toBe(
          "process.exit"
        );
        // Pipeline convention: a closed reader is success, not an error.
        expect(exitSpy).toHaveBeenCalledWith(0);
        expect(trackSpy.mock.calls[0][3]).toMatchObject({
          outcome: "cancelled",
          error_kind: "broken_pipe",
        });
      } finally {
        exitSpy.mockRestore();
        trackSpy.mockRestore();
      }
    });
  });
});
