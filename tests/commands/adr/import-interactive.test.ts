// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  type Mock,
  spyOn,
  test,
} from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before imports that use them.
// ---------------------------------------------------------------------------

interface ConfirmQuestion {
  name: string;
  message: string;
  default?: boolean;
}

/** Answer returned by the next confirmation prompt; set per test. */
let promptConfirm = true;

const mockInquirerPrompt = mock(
  async (_questions: ConfirmQuestion[]): Promise<{ confirm: boolean }> => ({
    confirm: promptConfirm,
  })
);

void mock.module("node:readline", () => ({ cursorTo: mock(() => true) }));
void mock.module("inquirer", () => ({
  default: { prompt: mockInquirerPrompt },
}));

// ---------------------------------------------------------------------------
// Imports under test — loaded AFTER mocks are registered.
// ---------------------------------------------------------------------------

import { registerAdrImportCommand } from "../../../src/commands/adr/import";
import { parsePackMetadata } from "../../../src/formats/pack";
import { withPromptFix } from "../../../src/helpers/prompt";
import * as registryMod from "../../../src/helpers/registry";
import { safeRmSync } from "../../test-utils";

const PACK_YAML =
  "name: test-pack\nversion: 0.1.0\ndescription: A test pack for import testing.\nmaintainers:\n  - github: testuser\ntags: []\nrequires: []";

const ADR_1 =
  "---\nid: TP-001\ntitle: Test Rule\ndomain: architecture\nrules: false\n---\n\n## Context\nTest ADR.";

const ADR_2 =
  "---\nid: TP-002\ntitle: Another Rule\ndomain: architecture\nrules: false\n---\n\n## Context\nAnother test ADR.";

// Stand-ins for the first-party registry module, installed with spyOn rather
// than mock.module: mock.module on a first-party module is process-global and
// would leak into tests/helpers/registry.test.ts (ARCH-005).
const fakeResolveSource: typeof registryMod.resolveSource = (input) => ({
  kind: "official",
  repoUrl: "https://github.com/archgate/awesome-adrs.git",
  ref: undefined,
  subpath: input,
});

const fakeDetectTarget: typeof registryMod.detectTarget = async (
  cloneDir,
  subpath
) => {
  const fullPath = join(cloneDir, subpath);
  const raw = await Bun.file(join(fullPath, "archgate-pack.yaml")).text();
  const adrsDir = join(fullPath, "adrs");
  const entries = existsSync(adrsDir) ? readdirSync(adrsDir) : [];
  return {
    kind: "pack",
    packMeta: parsePackMetadata(raw),
    adrFiles: entries
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(adrsDir, f)),
    rulesFiles: [],
    baseDir: adrsDir,
  };
};

describe("adr import interactive confirmation", () => {
  let tempDir: string;
  let upstreamDir: string;
  let originalCwd: string;
  let logSpy: Mock<typeof console.log>;

  // withPromptFix permanently rebinds console.log on Windows the first time it
  // runs (ARCH-019). Warming it up before any spy is installed keeps the
  // console.log spy below stable and its restore faithful.
  beforeAll(async () => {
    await withPromptFix(async () => true);
  });

  beforeEach(() => {
    promptConfirm = true;
    mockInquirerPrompt.mockClear();
    // realpathSync normalizes macOS /var → /private/var so paths match cwd.
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "archgate-import-int-")));
    upstreamDir = realpathSync(
      mkdtempSync(join(tmpdir(), "archgate-upstream-int-"))
    );
    originalCwd = process.cwd();
    Bun.env.ARCHGATE_PROJECT_CEILING = tempDir;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    spyOn(registryMod, "resolveSource").mockImplementation(fakeResolveSource);
    spyOn(registryMod, "detectTarget").mockImplementation(fakeDetectTarget);
    spyOn(registryMod, "shallowClone").mockImplementation(
      async () => upstreamDir
    );
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    delete Bun.env.ARCHGATE_PROJECT_CEILING;
    safeRmSync(tempDir);
    safeRmSync(upstreamDir);
    mock.restore();
  });

  function scaffoldUpstreamPack(adrs: string[]): void {
    const packDir = join(upstreamDir, "packs", "test-pack");
    const adrsDir = join(packDir, "adrs");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(join(packDir, "archgate-pack.yaml"), PACK_YAML);
    adrs.forEach((content, index) => {
      writeFileSync(join(adrsDir, `TP-00${index + 1}-rule.md`), content);
    });
  }

  function makeProgram(): Command {
    const parent = new Command("adr").exitOverride();
    registerAdrImportCommand(parent);
    return parent;
  }

  function allOutput(): string {
    return logSpy.mock.calls.map((c) => String(c[0])).join("\n");
  }

  function importedMarkdown(): string[] {
    return readdirSync(join(tempDir, ".archgate", "adrs")).filter((f) =>
      f.endsWith(".md")
    );
  }

  const BASE_ARGS = ["node", "adr", "import"];

  test("reports nothing to import when the pack holds no ADRs", async () => {
    scaffoldUpstreamPack([]);

    await makeProgram().parseAsync([...BASE_ARGS, "packs/test-pack"]);

    expect(allOutput()).toContain("No ADRs found to import.");
    expect(mockInquirerPrompt).not.toHaveBeenCalled();
    expect(importedMarkdown()).toHaveLength(0);
  });

  test("writes the ADRs when the confirmation is accepted", async () => {
    scaffoldUpstreamPack([ADR_1, ADR_2]);
    promptConfirm = true;

    await makeProgram().parseAsync([...BASE_ARGS, "packs/test-pack"]);

    expect(mockInquirerPrompt).toHaveBeenCalledTimes(1);
    expect(importedMarkdown()).toHaveLength(2);
    expect(allOutput()).toContain("Imported 2 ADR(s)");
    expect(existsSync(join(tempDir, ".archgate", "imports.json"))).toBe(true);
  });

  test("writes nothing when the confirmation is declined", async () => {
    scaffoldUpstreamPack([ADR_1, ADR_2]);
    promptConfirm = false;

    await makeProgram().parseAsync([...BASE_ARGS, "packs/test-pack"]);

    expect(mockInquirerPrompt).toHaveBeenCalledTimes(1);
    expect(allOutput()).toContain("Import cancelled.");
    expect(importedMarkdown()).toHaveLength(0);
    expect(existsSync(join(tempDir, ".archgate", "imports.json"))).toBe(false);
  });

  test("asks a defaulted confirm question naming the ADR count", async () => {
    scaffoldUpstreamPack([ADR_1, ADR_2]);

    await makeProgram().parseAsync([...BASE_ARGS, "packs/test-pack"]);

    const question = mockInquirerPrompt.mock.calls[0][0][0];
    expect(question.name).toBe("confirm");
    expect(question.message).toBe("Import 2 ADR(s)?");
    expect(question.default).toBe(true);
  });

  test("skips the prompt entirely with --yes", async () => {
    scaffoldUpstreamPack([ADR_1]);

    await makeProgram().parseAsync([...BASE_ARGS, "--yes", "packs/test-pack"]);

    expect(mockInquirerPrompt).not.toHaveBeenCalled();
    expect(importedMarkdown()).toHaveLength(1);
  });
});
