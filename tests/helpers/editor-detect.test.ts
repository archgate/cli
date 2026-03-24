import { describe, expect, test } from "bun:test";

import { detectEditors } from "../../src/helpers/editor-detect";

describe("editor-detect", () => {
  describe("detectEditors", () => {
    test("returns all four editors with availability status", async () => {
      const editors = await detectEditors();

      expect(editors).toHaveLength(4);
      expect(editors.map((e) => e.id)).toEqual([
        "claude",
        "cursor",
        "vscode",
        "copilot",
      ]);

      for (const editor of editors) {
        expect(typeof editor.available).toBe("boolean");
        expect(typeof editor.label).toBe("string");
        expect(editor.label.length).toBeGreaterThan(0);
      }
    });
  });
});
