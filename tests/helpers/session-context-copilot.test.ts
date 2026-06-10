// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { readCopilotSession } from "../../src/helpers/session-context-copilot";

// This file covers readCopilotSession happy-path and error-case tests.

describe("readCopilotSession", () => {
  const uniqueId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Use a fake project root that we'll put in workspace.yaml cwd
  const projectRoot = resolve(`/__archgate_copilot_test_${uniqueId}`);
  let tempHome: string;
  let savedHome: string | undefined;
  let stateDir: string;

  beforeEach(() => {
    // Redirect copilotSessionStateDir() into a temp dir so these tests never
    // touch the real ~/.copilot/session-state. The resolver reads Bun.env.HOME
    // at call time (paths.ts), so an env override works here — unlike
    // os.homedir() consumers, which require mocking (ARCH-005).
    tempHome = mkdtempSync(join(tmpdir(), "archgate-copilot-session-"));
    savedHome = Bun.env.HOME;
    Bun.env.HOME = tempHome;
    stateDir = join(tempHome, ".copilot", "session-state");
    mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    if (savedHome === undefined) delete Bun.env.HOME;
    else Bun.env.HOME = savedHome;
    rmSync(tempHome, { recursive: true, force: true });
  });

  function makeSession(
    sessionId: string,
    cwd: string,
    events?: string[]
  ): void {
    const sessionDir = join(stateDir, sessionId);
    mkdirSync(sessionDir, { recursive: true });

    // Write workspace.yaml — use JSON.stringify to escape backslashes
    // in Windows paths (YAML double-quoted strings use the same escaping)
    const yaml = `cwd: ${JSON.stringify(cwd)}\nid: ${JSON.stringify(sessionId)}\n`;
    writeFileSync(join(sessionDir, "workspace.yaml"), yaml);

    // Write events.jsonl if provided
    if (events) {
      writeFileSync(join(sessionDir, "events.jsonl"), events.join("\n"));
    }
  }

  test("returns data for most recent session matching project", async () => {
    const sessionId = `copilot-${uniqueId}-1`;
    makeSession(sessionId, projectRoot, [
      JSON.stringify({
        type: "user.message",
        timestamp: "2026-01-01T00:00:00Z",
        data: { content: "hello copilot" },
      }),
      JSON.stringify({
        type: "assistant.message",
        timestamp: "2026-01-01T00:00:01Z",
        data: { content: "hi there" },
      }),
    ]);

    const result = await readCopilotSession(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.data.sessionId).toBe(sessionId);
    expect(result.data.sessionFile).toBe("events.jsonl");
    expect(result.data.totalEntries).toBe(2);
    expect(result.data.relevantEntries).toBe(2);
    expect(result.data.transcript[0]).toEqual({
      role: "user",
      contentPreview: "hello copilot",
    });
    expect(result.data.transcript[1]).toEqual({
      role: "assistant",
      contentPreview: "hi there",
    });
  });

  test("finds session by sessionId", async () => {
    const sessionId1 = `copilot-${uniqueId}-first`;
    const sessionId2 = `copilot-${uniqueId}-second`;

    makeSession(sessionId1, projectRoot, [
      JSON.stringify({
        type: "user.message",
        data: { content: "first session" },
      }),
    ]);
    makeSession(sessionId2, projectRoot, [
      JSON.stringify({
        type: "user.message",
        data: { content: "second session" },
      }),
    ]);

    const result = await readCopilotSession(projectRoot, {
      sessionId: sessionId1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.data.sessionId).toBe(sessionId1);
    expect(result.data.transcript[0]?.contentPreview).toBe("first session");
  });

  test("returns error when sessionId not found (with available list)", async () => {
    const sessionId = `copilot-${uniqueId}-real`;
    makeSession(sessionId, projectRoot, [
      JSON.stringify({ type: "user.message", data: { content: "real" } }),
    ]);

    const result = await readCopilotSession(projectRoot, {
      sessionId: "nonexistent-id",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("nonexistent-id");
      expect(result.available).toContain(sessionId);
    }
  });

  test("filters to user.message and assistant.message events only", async () => {
    const sessionId = `copilot-${uniqueId}-filter`;
    makeSession(sessionId, projectRoot, [
      JSON.stringify({
        type: "session.start",
        data: { context: { repository: "test" } },
      }),
      JSON.stringify({
        type: "tool.call",
        data: { name: "bash", input: "ls" },
      }),
      JSON.stringify({ type: "user.message", data: { content: "visible" } }),
      JSON.stringify({
        type: "assistant.message",
        data: { content: "also visible" },
      }),
    ]);

    const result = await readCopilotSession(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.data.totalEntries).toBe(4);
    expect(result.data.relevantEntries).toBe(2);
    expect(result.data.transcript[0]?.contentPreview).toBe("visible");
    expect(result.data.transcript[1]?.contentPreview).toBe("also visible");
  });

  test("returns error when session has no events.jsonl", async () => {
    const sessionId = `copilot-${uniqueId}-noevents`;
    makeSession(sessionId, projectRoot); // no events array

    const result = await readCopilotSession(projectRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no conversation transcript");
    }
  });

  test("returns error when no sessions match the project", async () => {
    const sessionId = `copilot-${uniqueId}-other`;
    makeSession(sessionId, "/some/other/project", [
      JSON.stringify({
        type: "user.message",
        data: { content: "wrong project" },
      }),
    ]);

    const result = await readCopilotSession(projectRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("No Copilot CLI sessions found");
    }
  });

  test("handles malformed events.jsonl", async () => {
    const sessionId = `copilot-${uniqueId}-bad`;
    const sessionDir = join(stateDir, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "workspace.yaml"),
      `cwd: ${JSON.stringify(projectRoot)}\nid: ${JSON.stringify(sessionId)}\n`
    );
    writeFileSync(join(sessionDir, "events.jsonl"), "}{not valid json at all");

    const result = await readCopilotSession(projectRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no conversation transcript");
    }
  });

  test("respects maxEntries — keeps last N relevant entries", async () => {
    const sessionId = `copilot-${uniqueId}-limit`;
    const events: string[] = [];
    for (let i = 0; i < 8; i++) {
      events.push(
        JSON.stringify({
          type: i % 2 === 0 ? "user.message" : "assistant.message",
          data: { content: `msg ${i}` },
        })
      );
    }
    makeSession(sessionId, projectRoot, events);

    const result = await readCopilotSession(projectRoot, { maxEntries: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.data.relevantEntries).toBe(8);
    expect(result.data.transcript).toHaveLength(2);
    // slice(-2) keeps last 2 — messages 6 and 7
    expect(result.data.transcript[0]?.contentPreview).toBe("msg 6");
    expect(result.data.transcript[1]?.contentPreview).toBe("msg 7");
  });

  test("returns error when session-state directory does not exist", async () => {
    const result = await readCopilotSession(
      "/nonexistent/path/that/wont/match"
    );
    // This may return "no sessions found for this project" or "no session-state dir"
    // depending on whether ~/.copilot/session-state/ exists
    expect(result.ok).toBe(false);
  });

  test("skip option reads the second-most-recent matching session", async () => {
    // Create parent session (make it older by creating first)
    const parentId = `copilot-${uniqueId}-parent`;
    makeSession(parentId, projectRoot, [
      JSON.stringify({
        type: "user.message",
        data: { content: "parent question" },
      }),
      JSON.stringify({
        type: "assistant.message",
        data: { content: "parent answer" },
      }),
    ]);

    // Make parent dir older so sub-agent dir is most recent
    const { utimesSync } = await import("node:fs");
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(stateDir, parentId), past, past);

    // Create sub-agent session (newer)
    const subagentId = `copilot-${uniqueId}-subagent`;
    makeSession(subagentId, projectRoot, [
      JSON.stringify({
        type: "user.message",
        data: { content: "sub-agent init" },
      }),
    ]);

    // Without skip → reads sub-agent session (most recent)
    const resultNoSkip = await readCopilotSession(projectRoot);
    expect(resultNoSkip.ok).toBe(true);
    if (!resultNoSkip.ok) throw new Error("expected ok");
    expect(resultNoSkip.data.sessionId).toBe(subagentId);

    // With skip=1 → reads parent session
    const resultSkip = await readCopilotSession(projectRoot, { skip: 1 });
    expect(resultSkip.ok).toBe(true);
    if (!resultSkip.ok) throw new Error("expected ok");
    expect(resultSkip.data.sessionId).toBe(parentId);
    expect(resultSkip.data.transcript[0]?.contentPreview).toBe(
      "parent question"
    );
  });

  test("skip beyond available matching sessions returns error", async () => {
    const sessionId = `copilot-${uniqueId}-onlysession`;
    makeSession(sessionId, projectRoot, [
      JSON.stringify({
        type: "user.message",
        data: { content: "only session" },
      }),
    ]);

    const result = await readCopilotSession(projectRoot, { skip: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("--skip 2 requested");
    }
  });

  test("truncates string content preview to 500 chars", async () => {
    const sessionId = `copilot-${uniqueId}-truncate`;
    makeSession(sessionId, projectRoot, [
      JSON.stringify({
        type: "user.message",
        data: { content: "x".repeat(600) },
      }),
    ]);

    const result = await readCopilotSession(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const preview = result.data.transcript[0]?.contentPreview ?? "";
    expect(preview).toHaveLength(503); // 500 chars + "..."
    expect(preview.endsWith("...")).toBe(true);
  });
});
