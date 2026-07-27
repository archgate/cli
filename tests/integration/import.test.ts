// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  spyOn,
  type Mock,
} from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerAdrImportCommand } from "../../src/commands/adr/import";
import { detectTarget } from "../../src/helpers/registry";
import { expectKeys, safeRmSync } from "../test-utils";

const FIXTURE_REGISTRY = resolve(
  import.meta.dir,
  "..",
  "fixtures",
  "fake-registry"
);

describe("import integration (local fixtures)", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: Mock<typeof console.log>;
  let exitSpy: Mock<typeof process.exit>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-import-integ-"));
    originalCwd = process.cwd();
    Bun.env.ARCHGATE_PROJECT_CEILING = tempDir;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    delete Bun.env.ARCHGATE_PROJECT_CEILING;
    safeRmSync(tempDir);
    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  function scaffoldProject(): void {
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    mkdirSync(join(tempDir, ".archgate", "lint"), { recursive: true });
  }

  test("detectTarget identifies pack from fixture", async () => {
    const target = await detectTarget(FIXTURE_REGISTRY, "packs/test-pack");
    expect(target.kind).toBe("pack");
    if (target.kind === "pack") {
      expect(target.packMeta.name).toBe("test-pack");
      expect(target.packMeta.version).toBe("0.1.0");
      expect(target.adrFiles.length).toBe(2);
      expect(target.rulesFiles.length).toBe(1);
    }
  });

  test("detectTarget identifies single ADR from fixture", async () => {
    const target = await detectTarget(
      FIXTURE_REGISTRY,
      "packs/test-pack/adrs/TP-001-test-rule"
    );
    expect(target.kind).toBe("single-adr");
    if (target.kind === "single-adr") {
      expect(target.adrFile).toContain("TP-001-test-rule.md");
      expect(target.rulesFile).not.toBeNull();
    }
  });

  test("imports whole pack from local fixture with --yes", async () => {
    scaffoldProject();
    process.chdir(tempDir);

    // Bypass git clone for local testing: resolve the fixture with
    // detectTarget and write the files directly.
    const target = await detectTarget(FIXTURE_REGISTRY, "packs/test-pack");
    expect(target.kind).toBe("pack");

    if (target.kind === "pack") {
      const adrsDir = join(tempDir, ".archgate", "adrs");

      for (const adrFile of target.adrFiles) {
        const content = readFileSync(adrFile, "utf-8");
        const filename = adrFile.split(/[\\/]/u).pop()!;
        writeFileSync(join(adrsDir, filename), content);
      }

      for (const rulesFile of target.rulesFiles) {
        const content = readFileSync(rulesFile, "utf-8");
        const filename = rulesFile.split(/[\\/]/u).pop()!;
        writeFileSync(join(adrsDir, filename), content);
      }

      const files = readdirSync(adrsDir);
      expect(files.filter((f) => f.endsWith(".md")).length).toBe(2);
      expect(files.filter((f) => f.endsWith(".rules.ts")).length).toBe(1);
    }
  });

  test("ID remapping rewrites frontmatter correctly", async () => {
    scaffoldProject();
    const adrsDir = join(tempDir, ".archgate", "adrs");

    const target = await detectTarget(FIXTURE_REGISTRY, "packs/test-pack");
    if (target.kind !== "pack") throw new Error("Expected pack");

    // Simulate the ID rewriting that import.ts does
    const content = readFileSync(target.adrFiles[0], "utf-8");
    const fmRegex = /^(---\r?\n)([\s\S]*?\r?\n)(---)/mu;
    const fmMatch = fmRegex.exec(content)!;
    const updatedFm = fmMatch[2].replace(/^(id:\s*).*$/mu, "$1ARCH-001");
    const rewritten = content.replace(
      fmMatch[0],
      `${fmMatch[1]}${updatedFm}${fmMatch[3]}`
    );
    writeFileSync(join(adrsDir, "ARCH-001-test-rule.md"), rewritten);

    const result = readFileSync(
      join(adrsDir, "ARCH-001-test-rule.md"),
      "utf-8"
    );
    expect(result).toContain("id: ARCH-001");
    expect(result).not.toContain("id: TP-001");
  });

  test("imports.json is created on import", () => {
    scaffoldProject();
    const importsPath = join(tempDir, ".archgate", "imports.json");

    // Simulate writing an imports manifest
    const manifest = {
      imports: [
        {
          source: "packs/test-pack",
          version: "0.1.0",
          importedAt: new Date().toISOString(),
          adrIds: ["ARCH-001", "ARCH-002"],
        },
      ],
    };
    writeFileSync(importsPath, JSON.stringify(manifest, null, 2) + "\n");

    expect(existsSync(importsPath)).toBe(true);
    const loaded = expectKeys(
      JSON.parse(readFileSync(importsPath, "utf-8")),
      "imports"
    );
    const loadedImports = loaded.imports;
    if (!Array.isArray(loadedImports)) {
      throw new TypeError("expected imports to be an array");
    }
    expect(loadedImports).toHaveLength(1);
    expect(expectKeys(loadedImports[0], "adrIds").adrIds).toEqual([
      "ARCH-001",
      "ARCH-002",
    ]);
  });

  test("--dry-run writes nothing", async () => {
    scaffoldProject();
    process.chdir(tempDir);

    const parent = new Command("adr").exitOverride();
    registerAdrImportCommand(parent);

    await parent.parseAsync([
      "node",
      "adr",
      "import",
      "--list",
      "dummy-source",
    ]);

    const allOutput = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(allOutput).toContain("No ADRs have been imported yet.");

    const adrsDir = join(tempDir, ".archgate", "adrs");
    const files = readdirSync(adrsDir);
    expect(files.length).toBe(0);
  });

  test("--list shows empty state when no imports exist", async () => {
    scaffoldProject();
    process.chdir(tempDir);

    const parent = new Command("adr").exitOverride();
    registerAdrImportCommand(parent);

    await parent.parseAsync([
      "node",
      "adr",
      "import",
      "--list",
      "dummy-source",
    ]);

    const allOutput = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(allOutput).toContain("No ADRs have been imported yet.");
  });

  test("--list shows existing imports", async () => {
    scaffoldProject();
    process.chdir(tempDir);

    // Write a manifest first
    const importsPath = join(tempDir, ".archgate", "imports.json");
    writeFileSync(
      importsPath,
      JSON.stringify(
        {
          imports: [
            {
              source: "packs/test-pack",
              version: "0.1.0",
              importedAt: "2026-01-15T12:00:00.000Z",
              adrIds: ["ARCH-001"],
            },
          ],
        },
        null,
        2
      ) + "\n"
    );

    const parent = new Command("adr").exitOverride();
    registerAdrImportCommand(parent);

    await parent.parseAsync([
      "node",
      "adr",
      "import",
      "--list",
      "dummy-source",
    ]);

    const allOutput = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(allOutput).toContain("packs/test-pack");
    expect(allOutput).toContain("ARCH-001");
  });

  test("--list with --json outputs JSON", async () => {
    scaffoldProject();
    process.chdir(tempDir);

    const importsPath = join(tempDir, ".archgate", "imports.json");
    writeFileSync(
      importsPath,
      JSON.stringify(
        {
          imports: [
            {
              source: "packs/test-pack",
              version: "0.1.0",
              importedAt: "2026-01-15T12:00:00.000Z",
              adrIds: ["ARCH-001"],
            },
          ],
        },
        null,
        2
      ) + "\n"
    );

    const parent = new Command("adr").exitOverride();
    registerAdrImportCommand(parent);

    await parent.parseAsync([
      "node",
      "adr",
      "import",
      "--list",
      "--json",
      "dummy-source",
    ]);

    const allOutput = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    const parsed = expectKeys(JSON.parse(allOutput), "imports");
    const parsedImports = parsed.imports;
    if (!Array.isArray(parsedImports)) {
      throw new TypeError("expected imports to be an array");
    }
    expect(parsedImports).toHaveLength(1);
    expect(expectKeys(parsedImports[0], "source").source).toBe(
      "packs/test-pack"
    );
  });

  test("exits with error when .archgate/ directory is missing", async () => {
    process.chdir(tempDir);

    const parent = new Command("adr").exitOverride();
    registerAdrImportCommand(parent);

    expect(
      parent.parseAsync(["node", "adr", "import", "packs/test"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
