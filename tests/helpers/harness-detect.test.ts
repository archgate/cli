// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  DETECTED_HARNESSES,
  detectHarness,
  type DetectedHarness,
} from "../../src/helpers/harness-detect";
import { restoreEnv } from "../test-utils";

// Every variable detectHarness() consults. The suite runs inside a real
// harness (CLAUDECODE is set), so all of them are cleared before each test —
// otherwise the ambient environment leaks into every assertion.
const HARNESS_VARS = [
  "ANTIGRAVITY_AGENT",
  "ANTIGRAVITY_CONVERSATION_ID",
  "CLAUDECODE",
  "CLAUDE_CODE_SESSION_ID",
  "CODEX_THREAD_ID",
  "COPILOT_CLI",
  "COPILOT_AGENT_SESSION_ID",
  "CURSOR_AGENT",
  "CURSOR_CONVERSATION_ID",
  "OPENCODE",
  "OPENCODE_CLIENT",
  "PI_CODING_AGENT",
  "PI_SESSION_ID",
] as const;

const UUID = "261667f2-f770-40fd-bbfd-c70dc1f0a80c";

/** Each editor paired with an env var that identifies it. */
const MARKER_CASES: Array<[DetectedHarness, string]> = [
  ["antigravity", "ANTIGRAVITY_AGENT"],
  ["claude-code", "CLAUDECODE"],
  ["codex", "CODEX_THREAD_ID"],
  ["copilot", "COPILOT_CLI"],
  ["cursor", "CURSOR_AGENT"],
  ["opencode", "OPENCODE"],
  ["opencode", "OPENCODE_CLIENT"],
  ["pi", "PI_CODING_AGENT"],
];

describe("detectHarness", () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of HARNESS_VARS) {
      saved.set(key, Bun.env[key]);
      delete Bun.env[key];
    }
  });

  afterEach(() => {
    for (const key of HARNESS_VARS) {
      restoreEnv(key, saved.get(key));
    }
    saved.clear();
  });

  test("reports no editor when the environment carries no marker", () => {
    const result = detectHarness();

    expect(result.editor).toBeNull();
    expect(result.via).toBeNull();
    expect(result.candidates).toEqual([]);
    expect(result.envSessionId).toBeNull();
  });

  test.each(MARKER_CASES)("detects %s from %s", (editor, marker) => {
    Bun.env[marker] = "1";

    const result = detectHarness();

    expect(result.editor).toBe(editor);
    expect(result.via).toBe(marker);
    expect(result.candidates).toEqual([editor]);
  });

  test("every editor the CLI supports is detectable", () => {
    // SIGNALS is a list, so an editor added to DETECTED_HARNESSES without a
    // signal would compile and simply never be detected. This turns that
    // silent gap into a failure.
    const covered = new Set(MARKER_CASES.map(([editor]) => editor));
    expect(DETECTED_HARNESSES.filter((h) => !covered.has(h))).toEqual([]);
  });

  test.each<[string, string, string]>([
    ["antigravity", "ANTIGRAVITY_AGENT", "ANTIGRAVITY_CONVERSATION_ID"],
    ["claude-code", "CLAUDECODE", "CLAUDE_CODE_SESSION_ID"],
    ["codex", "CODEX_THREAD_ID", "CODEX_THREAD_ID"],
    ["copilot", "COPILOT_CLI", "COPILOT_AGENT_SESSION_ID"],
    ["cursor", "CURSOR_AGENT", "CURSOR_CONVERSATION_ID"],
    ["pi", "PI_CODING_AGENT", "PI_SESSION_ID"],
  ])("%s publishes its session id via %s", (_editor, marker, idVar) => {
    Bun.env[marker] = "1";
    Bun.env[idVar] = UUID;

    expect(detectHarness().envSessionId).toBe(UUID);
  });

  test("opencode publishes no session id", () => {
    Bun.env.OPENCODE = "1";

    expect(detectHarness().envSessionId).toBeNull();
  });

  describe("session id rejection", () => {
    // An unusable id must read as null, not "". The session readers treat
    // sessionId: "" exactly like undefined and fall back to recency, so a ""
    // here would make an unset variable indistinguishable from a rejected one.
    test.each([
      ["an empty value", ""],
      ["the literal string undefined", "undefined"],
    ])("rejects %s", (_label, value) => {
      Bun.env.CLAUDECODE = "1";
      Bun.env.CLAUDE_CODE_SESSION_ID = value;

      expect(detectHarness().envSessionId).toBeNull();
    });

    test("rejects a non-UUID cursor conversation id", () => {
      // Cursor's sanitizer rewrites % to _, which is lossless only for a
      // UUID; a rewritten value could otherwise collide with a real id.
      Bun.env.CURSOR_AGENT = "1";
      Bun.env.CURSOR_CONVERSATION_ID = "conversation_with_underscores";

      const result = detectHarness();

      expect(result.editor).toBe("cursor");
      expect(result.envSessionId).toBeNull();
    });

    test("accepts a non-UUID id from harnesses with a lossless id", () => {
      Bun.env.CLAUDECODE = "1";
      Bun.env.CLAUDE_CODE_SESSION_ID = "not-a-uuid";

      expect(detectHarness().envSessionId).toBe("not-a-uuid");
    });
  });

  describe("precedence", () => {
    test("prefers claude-code over every other harness", () => {
      Bun.env.CLAUDECODE = "1";
      Bun.env.COPILOT_CLI = "1";
      Bun.env.CURSOR_AGENT = "1";
      Bun.env.OPENCODE = "1";

      const result = detectHarness();

      expect(result.editor).toBe("claude-code");
      expect(result.via).toBe("CLAUDECODE");
    });

    test("ranks opencode last, since it publishes no session id", () => {
      Bun.env.CURSOR_AGENT = "1";
      Bun.env.OPENCODE = "1";

      expect(detectHarness().editor).toBe("cursor");
    });

    test("reports every match in precedence order", () => {
      Bun.env.OPENCODE = "1";
      Bun.env.COPILOT_CLI = "1";
      Bun.env.CLAUDECODE = "1";

      expect(detectHarness().candidates).toEqual([
        "claude-code",
        "copilot",
        "opencode",
      ]);
    });

    test("takes the session id of the winner, not of a runner-up", () => {
      Bun.env.CLAUDECODE = "1";
      Bun.env.CURSOR_AGENT = "1";
      Bun.env.CURSOR_CONVERSATION_ID = UUID;

      const result = detectHarness();

      expect(result.editor).toBe("claude-code");
      expect(result.envSessionId).toBeNull();
    });
  });

  test("ignores a marker set to an empty value", () => {
    Bun.env.CLAUDECODE = "";

    expect(detectHarness().editor).toBeNull();
  });
});
