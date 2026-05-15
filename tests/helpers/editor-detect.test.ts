// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before imports that use them.
// ---------------------------------------------------------------------------

/** Tracks calls to cursorTo from node:readline. */
const mockCursorTo = mock(() => true);
mock.module("node:readline", () => ({ cursorTo: mockCursorTo }));

/** Mock inquirer so prompts resolve immediately without user interaction. */
mock.module("inquirer", () => ({
  default: { prompt: mock(() => Promise.resolve({ selected: ["claude"] })) },
}));

// ---------------------------------------------------------------------------
// Imports under test — loaded AFTER mocks are registered.
// ---------------------------------------------------------------------------

import type { DetectedEditor } from "../../src/helpers/editor-detect";
import {
  detectEditors,
  promptEditorSelection,
  promptSingleEditorSelection,
} from "../../src/helpers/editor-detect";

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const MOCK_DETECTED: DetectedEditor[] = [
  { id: "claude", label: "Claude Code", available: true },
  { id: "cursor", label: "Cursor", available: false },
  { id: "vscode", label: "VS Code", available: true },
  { id: "copilot", label: "GitHub Copilot", available: false },
  { id: "opencode", label: "opencode", available: false },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("editor-detect", () => {
  describe("detectEditors", () => {
    test("returns all five editors with availability status", async () => {
      const editors = await detectEditors();

      expect(editors).toHaveLength(5);
      expect(editors.map((e) => e.id)).toEqual([
        "claude",
        "cursor",
        "vscode",
        "copilot",
        "opencode",
      ]);

      for (const editor of editors) {
        expect(typeof editor.available).toBe("boolean");
        expect(typeof editor.label).toBe("string");
        expect(editor.label.length).toBeGreaterThan(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Cursor reset after inquirer prompts (Windows spacing fix)
  //
  // On Windows terminals, inquirer leaves the cursor at the column where the
  // wrapped answer text ended. Without an explicit cursorTo(stdout, 0),
  // subsequent output lines start at the wrong horizontal offset.
  // -------------------------------------------------------------------------

  // Cursor reset is part of the Windows-only withPromptFix() workaround.
  // These tests only run on Windows where the fix is active.
  describe.skipIf(process.platform !== "win32")(
    "promptEditorSelection — cursor reset (Windows)",
    () => {
      const originalIsTTY = process.stdout.isTTY;

      beforeEach(() => {
        mockCursorTo.mockClear();
      });

      afterEach(() => {
        Object.defineProperty(process.stdout, "isTTY", {
          value: originalIsTTY,
          writable: true,
          configurable: true,
        });
      });

      test("resets cursor to column 0 after prompt when stdout is TTY", async () => {
        Object.defineProperty(process.stdout, "isTTY", {
          value: true,
          writable: true,
          configurable: true,
        });

        await promptEditorSelection(MOCK_DETECTED);

        expect(mockCursorTo).toHaveBeenCalledTimes(1);
        expect(mockCursorTo).toHaveBeenCalledWith(process.stdout, 0);
      });

      test("does not call cursorTo when stdout is not TTY", async () => {
        Object.defineProperty(process.stdout, "isTTY", {
          value: undefined,
          writable: true,
          configurable: true,
        });

        await promptEditorSelection(MOCK_DETECTED);

        expect(mockCursorTo).not.toHaveBeenCalled();
      });
    }
  );

  describe.skipIf(process.platform !== "win32")(
    "promptSingleEditorSelection — cursor reset (Windows)",
    () => {
      const originalIsTTY = process.stdout.isTTY;

      beforeEach(() => {
        mockCursorTo.mockClear();
      });

      afterEach(() => {
        Object.defineProperty(process.stdout, "isTTY", {
          value: originalIsTTY,
          writable: true,
          configurable: true,
        });
      });

      test("resets cursor to column 0 after prompt when stdout is TTY", async () => {
        Object.defineProperty(process.stdout, "isTTY", {
          value: true,
          writable: true,
          configurable: true,
        });

        await promptSingleEditorSelection(MOCK_DETECTED);

        expect(mockCursorTo).toHaveBeenCalledTimes(1);
        expect(mockCursorTo).toHaveBeenCalledWith(process.stdout, 0);
      });

      test("does not call cursorTo when stdout is not TTY", async () => {
        Object.defineProperty(process.stdout, "isTTY", {
          value: undefined,
          writable: true,
          configurable: true,
        });

        await promptSingleEditorSelection(MOCK_DETECTED);

        expect(mockCursorTo).not.toHaveBeenCalled();
      });
    }
  );
});
