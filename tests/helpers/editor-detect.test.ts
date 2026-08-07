// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  type Mock,
  mock,
  spyOn,
  test,
} from "bun:test";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before imports that use them.
// ---------------------------------------------------------------------------

/**
 * Shape of the question objects both prompt helpers build. Declaring it here
 * (rather than asserting on `unknown`) lets tests read `choices`/`validate`
 * off the recorded call without a type assertion.
 */
interface EditorQuestion {
  choices?: { name: string; value: string; checked?: boolean }[];
  default?: string;
  validate?: (input: string[]) => boolean | string;
}

/** Mock inquirer so prompts resolve immediately without user interaction. */
const mockPrompt = mock(
  async (_questions: EditorQuestion[]): Promise<Record<string, unknown>> => ({
    selected: ["claude"],
  })
);
void mock.module("inquirer", () => ({ default: { prompt: mockPrompt } }));

/** The single question each helper passes to inquirer. */
function questionFrom(call: [EditorQuestion[]]): EditorQuestion {
  const questions = call[0];
  if (questions.length === 0) {
    throw new TypeError("inquirer was called without a question");
  }
  return questions[0];
}

// ---------------------------------------------------------------------------
// Imports under test — loaded AFTER mocks are registered.
// ---------------------------------------------------------------------------

import type { DetectedEditor } from "../../src/helpers/editor-detect";
import {
  detectEditors,
  promptEditorSelection,
  promptSingleEditorSelection,
} from "../../src/helpers/editor-detect";

const MOCK_DETECTED: DetectedEditor[] = [
  { id: "claude", label: "Claude Code", available: true },
  { id: "cursor", label: "Cursor", available: false },
  { id: "vscode", label: "VS Code", available: true },
  { id: "copilot", label: "GitHub Copilot", available: false },
  { id: "opencode", label: "opencode", available: false },
];

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

  describe("promptEditorSelection", () => {
    beforeEach(() => {
      mockPrompt.mockClear();
      mockPrompt.mockImplementation(async () => ({
        selected: ["claude", "vscode"],
      }));
    });

    test("returns the editors the user checked", async () => {
      expect(await promptEditorSelection(MOCK_DETECTED)).toEqual([
        "claude",
        "vscode",
      ]);
    });

    test("pre-checks detected editors and marks them in the label", async () => {
      await promptEditorSelection(MOCK_DETECTED);

      expect(questionFrom(mockPrompt.mock.calls[0]).choices).toEqual([
        { name: "Claude Code (detected)", value: "claude", checked: true },
        { name: "Cursor", value: "cursor", checked: false },
        { name: "VS Code (detected)", value: "vscode", checked: true },
        { name: "GitHub Copilot", value: "copilot", checked: false },
        { name: "opencode", value: "opencode", checked: false },
      ]);
    });

    test("its validator rejects an empty selection", async () => {
      await promptEditorSelection(MOCK_DETECTED);
      const { validate } = questionFrom(mockPrompt.mock.calls[0]);

      expect(validate?.([])).toBe("Select at least one editor.");
      expect(validate?.(["claude"])).toBe(true);
    });
  });

  describe("promptSingleEditorSelection", () => {
    beforeEach(() => {
      mockPrompt.mockClear();
      mockPrompt.mockImplementation(async () => ({ selected: "cursor" }));
    });

    test("returns the editor the user picked", async () => {
      expect(await promptSingleEditorSelection(MOCK_DETECTED)).toBe("cursor");
    });

    test("defaults to the first detected editor", async () => {
      // vscode is neither first in the list nor the no-detection fallback, so
      // only "first available wins" produces it.
      await promptSingleEditorSelection(
        MOCK_DETECTED.map((e) => ({ ...e, available: e.id === "vscode" }))
      );

      expect(questionFrom(mockPrompt.mock.calls[0]).default).toBe("vscode");
    });

    test("defaults to claude when nothing is detected", async () => {
      await promptSingleEditorSelection(
        MOCK_DETECTED.map((e) => ({ ...e, available: false }))
      );

      expect(questionFrom(mockPrompt.mock.calls[0]).default).toBe("claude");
    });

    test("offers every editor, detected or not", async () => {
      await promptSingleEditorSelection(MOCK_DETECTED);

      expect(questionFrom(mockPrompt.mock.calls[0]).choices).toEqual([
        { name: "Claude Code (detected)", value: "claude" },
        { name: "Cursor", value: "cursor" },
        { name: "VS Code (detected)", value: "vscode" },
        { name: "GitHub Copilot", value: "copilot" },
        { name: "opencode", value: "opencode" },
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Cursor reset after inquirer prompts (Windows spacing fix)
  //
  // On Windows terminals, inquirer leaves the cursor at the column where the
  // wrapped answer text ended. Without an explicit cursorTo(stdout, 0),
  // subsequent output lines start at the wrong horizontal offset.
  // -------------------------------------------------------------------------

  // Cursor reset is part of the Windows-only withPromptFix() workaround, so
  // these tests only run there. A `process.stdout.write` spy observes it —
  // stubbing `node:readline` is process-global and would neuter `cursorTo` for
  // every module loaded afterwards (ARCH-005).
  describe.skipIf(process.platform !== "win32")(
    "cursor reset (Windows)",
    () => {
      /** What `cursorTo(stream, 0)` writes to the stream. */
      const CURSOR_TO_START = `${String.fromCodePoint(27)}[1G`;

      function setStdoutIsTTY(value: boolean | undefined): void {
        Object.defineProperty(process.stdout, "isTTY", {
          value,
          writable: true,
          configurable: true,
        });
      }

      describe.each([
        ["promptEditorSelection", promptEditorSelection],
        ["promptSingleEditorSelection", promptSingleEditorSelection],
      ] as const)("%s", (_name, promptFn) => {
        const originalIsTTY = process.stdout.isTTY;
        let written: string[];
        let writeSpy: Mock<typeof process.stdout.write>;

        // withPromptFix wraps `process.stdout.write` in a permanent LF -> CRLF
        // proxy on its first call (ARCH-019). Install it before the spy so
        // `mockRestore()` puts that proxy back rather than dropping it.
        beforeAll(async () => {
          await promptFn(MOCK_DETECTED);
        });

        beforeEach(() => {
          written = [];
          writeSpy = spyOn(process.stdout, "write").mockImplementation(
            (chunk: unknown) => {
              written.push(String(chunk));
              return true;
            }
          );
        });

        afterEach(() => {
          writeSpy.mockRestore();
          setStdoutIsTTY(originalIsTTY);
        });

        test("resets cursor to column 0 after prompt when stdout is TTY", async () => {
          setStdoutIsTTY(true);

          await promptFn(MOCK_DETECTED);

          expect(written.join("")).toContain(CURSOR_TO_START);
        });

        test("does not reset the cursor when stdout is not TTY", async () => {
          setStdoutIsTTY(undefined);

          await promptFn(MOCK_DETECTED);

          expect(written.join("")).not.toContain(CURSOR_TO_START);
        });
      });
    }
  );
});
