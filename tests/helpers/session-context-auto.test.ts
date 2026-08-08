// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
  type Mock,
} from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

import { encodeProjectPath } from "../../src/helpers/session-context";
import {
  listAutoSessions,
  readAutoSession,
  readAutoSessionById,
} from "../../src/helpers/session-context-auto";
import { UserError } from "../../src/helpers/user-error";
import { restoreEnv } from "../test-utils";

// XDG_DATA_HOME is managed alongside the harness markers so the opencode
// reader resolves its database under the temp home. `os.homedir()` alone is
// not enough: opencodeDbPath() falls back to Bun.env.HOME, which the spy does
// not redirect, and the suite would otherwise read the real ~/.local/share.
const HARNESS_VARS = [
  // Every detection marker, so an ambient one cannot select an editor these
  // tests did not ask for. The suite may itself run inside any of them.
  "ANTIGRAVITY_AGENT",
  "ANTIGRAVITY_CONVERSATION_ID",
  "ANTIGRAVITY_SOURCE_METADATA",
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
  // Store locations, so the dispatch tests read the temp home rather than the
  // developer's real ~/.codex and ~/.pi.
  "XDG_DATA_HOME",
  "CODEX_HOME",
  "PI_CODING_AGENT_DIR",
  "PI_CODING_AGENT_SESSION_DIR",
  // Antigravity and Copilot resolve their stores from the home directory,
  // which the os.homedir() spy does not reach.
  "HOME",
  "USERPROFILE",
] as const;

const PROJECT_ROOT = "/__archgate_auto_project";

const OLDER_SESSION = "11111111-1111-4111-8111-111111111111";
const NEWER_SESSION = "22222222-2222-4222-8222-222222222222";

/** A JSONL transcript of `entries` user messages. */
function transcript(marker: string, entries = 1): string {
  return Array.from(
    { length: entries },
    (_, i) =>
      `${JSON.stringify({
        type: "user",
        message: { role: "user", content: `${marker}-${i}` },
      })}\n`
  ).join("");
}

/** Entry count in the newest session's fixture, for the trimming assertions. */
const NEWER_ENTRY_COUNT = 3;

/**
 * Number of transcript entries in a reader payload, or -1 when the field is
 * absent or not an array. Narrowed with `in` so the loosely typed `data`
 * needs no assertion.
 */
function transcriptLength(data: object): number {
  if (!("transcript" in data)) return -1;
  const entries = data.transcript;
  return Array.isArray(entries) ? entries.length : -1;
}

describe("session-context auto resolution", () => {
  const saved = new Map<string, string | undefined>();
  let tempHome: string;
  let homedirSpy: Mock<typeof os.homedir>;

  beforeEach(async () => {
    for (const key of HARNESS_VARS) {
      saved.set(key, Bun.env[key]);
      delete Bun.env[key];
    }

    tempHome = mkdtempSync(join(os.tmpdir(), "archgate-auto-session-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);
    Bun.env.XDG_DATA_HOME = join(tempHome, ".local", "share");
    Bun.env.CODEX_HOME = join(tempHome, ".codex");
    Bun.env.PI_CODING_AGENT_DIR = join(tempHome, ".pi", "agent");
    Bun.env.HOME = tempHome;
    Bun.env.USERPROFILE = tempHome;

    // Derived from the encoder, not restated — a hand-rolled copy drifts
    // silently. encodeProjectPath's output is asserted in session-context.test.ts.
    const encodedProject = await encodeProjectPath(PROJECT_ROOT);
    const projectsDir = join(tempHome, ".claude", "projects", encodedProject);
    mkdirSync(projectsDir, { recursive: true });

    // Written oldest-first so the recency order is unambiguous.
    writeFileSync(
      join(projectsDir, `${OLDER_SESSION}.jsonl`),
      transcript("older-session")
    );
    const past = new Date(Date.now() - 60_000);
    writeFileSync(
      join(projectsDir, `${NEWER_SESSION}.jsonl`),
      transcript("newer-session", NEWER_ENTRY_COUNT)
    );
    // Force OLDER_SESSION to be genuinely older than NEWER_SESSION.
    utimesSync(join(projectsDir, `${OLDER_SESSION}.jsonl`), past, past);
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    rmSync(tempHome, { recursive: true, force: true });
    for (const key of HARNESS_VARS) {
      restoreEnv(key, saved.get(key));
    }
    saved.clear();
  });

  describe("readAutoSession", () => {
    test("pins the session the harness published", async () => {
      Bun.env.CLAUDECODE = "1";
      Bun.env.CLAUDE_CODE_SESSION_ID = OLDER_SESSION;

      const result = await readAutoSession(PROJECT_ROOT);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.detection.session).toBe("pinned");
      expect(result.detection.editor).toBe("claude-code");
      // The pinned session is NOT the most recent one — proving the id was
      // honored rather than recency quietly agreeing with it.
      expect(result.data).toMatchObject({
        sessionFile: `${OLDER_SESSION}.jsonl`,
      });
    });

    test("falls back to recency when the published id matches nothing", async () => {
      // A stale id must degrade, never error: every reader hard-fails on an
      // unknown sessionId, so passing it through would break the command.
      Bun.env.CLAUDECODE = "1";
      Bun.env.CLAUDE_CODE_SESSION_ID = "99999999-9999-4999-8999-999999999999";

      const result = await readAutoSession(PROJECT_ROOT);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.detection.session).toBe("recent");
      expect(result.data).toMatchObject({
        sessionFile: `${NEWER_SESSION}.jsonl`,
      });
    });

    test("falls back to recency when the harness publishes no id", async () => {
      Bun.env.CLAUDECODE = "1";

      const result = await readAutoSession(PROJECT_ROOT);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.detection.session).toBe("recent");
      expect(result.data).toMatchObject({
        sessionFile: `${NEWER_SESSION}.jsonl`,
      });
    });

    test("treats an empty published id as absent, not as a pin", async () => {
      Bun.env.CLAUDECODE = "1";
      Bun.env.CLAUDE_CODE_SESSION_ID = "";

      const result = await readAutoSession(PROJECT_ROOT);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.detection.session).toBe("recent");
    });

    test("reports the reader's failure when no session exists", async () => {
      Bun.env.CLAUDECODE = "1";

      const result = await readAutoSession("/no/such/project");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("No session files found");
    });

    test("rejects an undetectable environment with actionable guidance", async () => {
      expect(readAutoSession(PROJECT_ROOT)).rejects.toThrow(UserError);
    });

    test("points at --editor when detection fails", async () => {
      expect(readAutoSession(PROJECT_ROOT)).rejects.toThrow(
        /--editor <claude-code\|copilot\|cursor\|opencode>/u
      );
    });

    test("returns every entry when maxEntries is not given", async () => {
      Bun.env.CLAUDECODE = "1";

      const result = await readAutoSession(PROJECT_ROOT);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(transcriptLength(result.data)).toBe(NEWER_ENTRY_COUNT);
    });

    test("caps the transcript with maxEntries", async () => {
      // The newest fixture holds NEWER_ENTRY_COUNT entries, so a cap of 1
      // must actually trim — otherwise dropping maxEntries would still pass.
      Bun.env.CLAUDECODE = "1";

      const result = await readAutoSession(PROJECT_ROOT, { maxEntries: 1 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(transcriptLength(result.data)).toBe(1);
      // The pre-trim count is reported alongside the trimmed transcript.
      expect(result.data).toMatchObject({ relevantEntries: NEWER_ENTRY_COUNT });
    });
  });

  describe("explicit editor override", () => {
    test("reads the named editor when nothing is detected", async () => {
      const result = await readAutoSession(PROJECT_ROOT, {
        editor: "claude-code",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.detection.editor).toBe("claude-code");
      expect(result.detection.via).toBe("--editor");
    });

    test("overrides the detected editor", async () => {
      Bun.env.CLAUDECODE = "1";

      const result = await listAutoSessions(PROJECT_ROOT, {
        editor: "opencode",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("opencode");
    });

    test("pins when the named editor is the one that published the id", async () => {
      Bun.env.CLAUDECODE = "1";
      Bun.env.CLAUDE_CODE_SESSION_ID = OLDER_SESSION;

      const result = await readAutoSession(PROJECT_ROOT, {
        editor: "claude-code",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.detection.session).toBe("pinned");
    });

    test("ignores a session id published by a different editor", async () => {
      // Cursor's conversation id must never pin a Claude Code session, even
      // though both are bare UUIDs and could collide by construction.
      Bun.env.CURSOR_AGENT = "1";
      Bun.env.CURSOR_CONVERSATION_ID = OLDER_SESSION;

      const result = await readAutoSession(PROJECT_ROOT, {
        editor: "claude-code",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.detection.session).toBe("recent");
      expect(result.data).toMatchObject({
        sessionFile: `${NEWER_SESSION}.jsonl`,
      });
    });
  });

  describe("dispatch", () => {
    // Each editor must reach its own reader. The temp home holds only Claude
    // Code fixtures, so any other editor answering with its own storage error
    // proves the call was routed there rather than to a default.
    test.each([
      ["antigravity", "Antigravity"],
      ["codex", "Codex"],
      ["copilot", "Copilot"],
      ["cursor", "Cursor"],
      ["opencode", "opencode"],
      ["pi", "Pi"],
    ] as const)("routes %s reads to its own reader", async (editor, marker) => {
      const result = await readAutoSession(PROJECT_ROOT, { editor });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain(marker);
    });

    test.each([
      ["antigravity", "Antigravity"],
      ["codex", "Codex"],
      ["copilot", "Copilot"],
      ["cursor", "Cursor"],
      ["opencode", "opencode"],
      ["pi", "Pi"],
    ] as const)("routes %s lists to its own reader", async (editor, marker) => {
      const result = await listAutoSessions(PROJECT_ROOT, { editor });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain(marker);
    });
  });

  describe("--root", () => {
    test.each(["claude-code", "copilot", "cursor"] as const)(
      "rejects --root for %s, which has no session graph",
      async (editor) => {
        expect(
          readAutoSession(PROJECT_ROOT, { editor, root: true })
        ).rejects.toThrow(UserError);
      }
    );

    test("accepts --root for opencode", async () => {
      // opencode has no database here, so reaching its reader's own error
      // proves the guard let the call through.
      const result = await readAutoSession(PROJECT_ROOT, {
        editor: "opencode",
        root: true,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("opencode");
    });
  });

  describe("readAutoSessionById", () => {
    test("an explicit id outranks the one the harness published", async () => {
      Bun.env.CLAUDECODE = "1";
      Bun.env.CLAUDE_CODE_SESSION_ID = NEWER_SESSION;

      const result = await readAutoSessionById(PROJECT_ROOT, OLDER_SESSION);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.detection.session).toBe("explicit");
      expect(result.data).toMatchObject({
        sessionFile: `${OLDER_SESSION}.jsonl`,
      });
    });

    test("surfaces the reader's error for an unknown id", async () => {
      Bun.env.CLAUDECODE = "1";

      const result = await readAutoSessionById(PROJECT_ROOT, "no-such-id");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("Session not found");
    });

    test("rejects an undetectable environment", async () => {
      expect(readAutoSessionById(PROJECT_ROOT, OLDER_SESSION)).rejects.toThrow(
        UserError
      );
    });
  });

  describe("listAutoSessions", () => {
    test("lists the detected editor's sessions, most recent first", async () => {
      Bun.env.CLAUDECODE = "1";

      const result = await listAutoSessions(PROJECT_ROOT);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.detection.editor).toBe("claude-code");
      expect(result.sessions.map((s) => s.id)).toEqual([
        NEWER_SESSION,
        OLDER_SESSION,
      ]);
    });

    test("routes to the detected editor rather than a default", async () => {
      // opencode has no database in the temp home, so its own error proves
      // the call was dispatched to the opencode reader.
      Bun.env.OPENCODE = "1";

      const result = await listAutoSessions(PROJECT_ROOT);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("opencode");
    });

    test("rejects an undetectable environment", async () => {
      expect(listAutoSessions(PROJECT_ROOT)).rejects.toThrow(UserError);
    });
  });
});
