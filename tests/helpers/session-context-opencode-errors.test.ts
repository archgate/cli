// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  listOpencodeSessions,
  readOpencodeSession,
} from "../../src/helpers/session-context-opencode";
import { restoreEnv } from "../test-utils";

/**
 * Failure paths of the opencode SQLite reader: the database is missing,
 * unopenable, unreadable, or schema-valid but empty. Lives beside
 * `session-context-opencode.test.ts` (happy paths) to stay under `max-lines`.
 */
describe("opencode session reader failure paths", () => {
  const uniqueId = `err-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const projectRoot = resolve(`/__archgate_opencode_err_${uniqueId}`);
  let tempDir: string;
  let dbPath: string;
  let originalXdg: string | undefined;

  beforeEach(() => {
    tempDir = join(tmpdir(), `archgate-opencode-err-${uniqueId}-${Date.now()}`);
    mkdirSync(join(tempDir, "opencode"), { recursive: true });
    dbPath = join(tempDir, "opencode", "opencode.db");

    originalXdg = Bun.env.XDG_DATA_HOME;
    Bun.env.XDG_DATA_HOME = tempDir;
  });

  afterEach(() => {
    restoreEnv("XDG_DATA_HOME", originalXdg);
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // On Windows, SQLite file handles may persist briefly after close.
      // Temp dirs use unique names, so leftover files don't affect other tests.
    }
  });

  /** Create the `session` table only — messages/parts are unused here. */
  function createSessionTable(): void {
    const db = new Database(dbPath);
    // DELETE journal mode avoids WAL/SHM sidecar files that lock on Windows.
    db.run("PRAGMA journal_mode = DELETE");
    db.run(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        directory TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        time_created INTEGER NOT NULL DEFAULT 0,
        time_updated INTEGER NOT NULL DEFAULT 0
      );
    `);
    db.close();
  }

  /** Replace the db path with a directory — SQLite cannot open it at all. */
  function makeDbPathUnopenable(): void {
    mkdirSync(dbPath, { recursive: true });
  }

  /** Write bytes with no SQLite header — opens lazily, fails on first query. */
  function makeDbUnreadable(): void {
    writeFileSync(dbPath, Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x42]));
  }

  test("list reports a missing database with the resolved path", () => {
    Bun.env.XDG_DATA_HOME = join(tempDir, "nonexistent");

    const result = listOpencodeSessions(projectRoot);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe("No opencode database found");
    expect(result.path).toContain("opencode.db");
  });

  test("list reports an unopenable database file", () => {
    makeDbPathUnopenable();

    const result = listOpencodeSessions(projectRoot);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe("Failed to open opencode database");
    expect(result.path).toBe(dbPath);
  });

  test("read reports an unopenable database file", () => {
    makeDbPathUnopenable();

    const result = readOpencodeSession(projectRoot);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe("Failed to open opencode database");
    expect(result.path).toBe(dbPath);
  });

  test("list reports a query failure on a corrupted database", () => {
    makeDbUnreadable();

    const result = listOpencodeSessions(projectRoot);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe("Failed to read opencode database");
    expect(result.path).toBe(dbPath);
  });

  test("read reports a query failure on a corrupted database", () => {
    makeDbUnreadable();

    const result = readOpencodeSession(projectRoot);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe("Failed to read opencode database");
    expect(result.path).toBe(dbPath);
  });

  test("read reports a query failure when the session table is absent", () => {
    const db = new Database(dbPath);
    db.run("PRAGMA journal_mode = DELETE");
    db.run("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
    db.close();

    const result = readOpencodeSession(projectRoot);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe("Failed to read opencode database");
  });

  test("read reports no sessions when the session table is empty", () => {
    createSessionTable();

    const result = readOpencodeSession(projectRoot);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe("No opencode sessions found");
    expect(result.path).toBe(dbPath);
  });

  test("list returns an empty session list when the table is empty", () => {
    createSessionTable();

    const result = listOpencodeSessions(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.sessions).toHaveLength(0);
  });
});
