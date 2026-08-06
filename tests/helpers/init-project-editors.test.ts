// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// ---------------------------------------------------------------------------
// Editor-dispatch edges of initProject: the exhaustiveness guard that fires
// when an unknown editor reaches configureEditorSettings, and the Cursor
// plugin install whose failure must not abort init.
// ---------------------------------------------------------------------------

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
  type Mock,
} from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as credentialStore from "../../src/helpers/credential-store";
import { initProject, type EditorTarget } from "../../src/helpers/init-project";
import * as pluginInstall from "../../src/helpers/plugin-install";
import { rejectionMessage, safeRmSync } from "../test-utils";

describe("initProject editor dispatch", () => {
  let tempDir: string;
  let credSpy: Mock<typeof credentialStore.loadCredentials>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-initproj-editor-"));
    credSpy = spyOn(credentialStore, "loadCredentials").mockResolvedValue(null);
  });

  afterEach(() => {
    credSpy.mockRestore();
    safeRmSync(tempDir);
  });

  test("rejects an editor outside the EditorTarget union", async () => {
    // The union makes this unreachable through the CLI (`--editor` restricts
    // its choices), so the exhaustiveness guard only fires for a caller that
    // bypasses the type — which is exactly what this asserts still throws.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const editor = "emacs" as EditorTarget;

    const message = await rejectionMessage(initProject(tempDir, { editor }));
    expect(message).toBe("Unhandled editor target: emacs");
  });

  test("a failed Cursor plugin install is reported, not thrown", async () => {
    credSpy.mockResolvedValue({ token: "tok", github_user: "user" });
    const installSpy = spyOn(
      pluginInstall,
      "installCursorPlugin"
    ).mockRejectedValue(new Error("tarball download returned 502"));

    try {
      const result = await initProject(tempDir, {
        installPlugin: true,
        editor: "cursor",
      });

      // Cursor's project-scope settings were still written, so init succeeded;
      // only the component download is reported as incomplete.
      expect(result.plugin).toEqual({
        installed: true,
        detail: "tarball download returned 502",
      });
      expect(installSpy).toHaveBeenCalledWith("tok");
    } finally {
      installSpy.mockRestore();
    }
  });
});
