// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";

import {
  beginCommand,
  finalizeCommand,
  _getExitState,
  _resetExitState,
} from "../../src/helpers/exit";

describe("exit helper", () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    _resetExitState();
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
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
      expect(() => finalizeCommand("", 0, "success")).not.toThrow();
    });
  });
});
