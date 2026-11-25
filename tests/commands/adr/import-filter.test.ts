// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  type Mock,
  spyOn,
  test,
} from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";
import { z } from "zod";

import { registerAdrImportCommand } from "../../../src/commands/adr/import";
import { registerAdrSyncCommand } from "../../../src/commands/adr/sync";
import { ImportsManifestSchema } from "../../../src/formats/pack";
import * as registryMod from "../../../src/helpers/registry";
import { restoreEnv, safeRmSync } from "../../test-utils";

const DryRunJsonSchema = z.object({
  dryRun: z.boolean(),
  adrs: z.array(z.object({ original: z.string(), newId: z.string() })),
});

const SyncJsonSchema = z.object({
  checked: z.number(),
  withChanges: z.number(),
  errors: z.number(),
  diffs: z.array(z.object({ adrId: z.string(), hasChanges: z.boolean() })),
});

const SUBPATH = "packs/sec";
const PACK_IDS = ["SEC-001", "SEC-002", "SEC-003"];

function adrBody(id: string): string {
  return `---\nid: ${id}\ntitle: Rule ${id}\ndomain: architecture\nrules: false\n---\n\n## Context\n\nBody of ${id}.\n`;
}

describe("adr import --only / --exclude", () => {
  let tempDir: string;
  let upstreamDir: string;
  let originalCwd: string;
  let originalCeiling: string | undefined;
  let logSpy: Mock<typeof console.log>;
  let exitSpy: Mock<typeof process.exit>;

  beforeEach(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "archgate-imp-filt-")));
    upstreamDir = realpathSync(
      mkdtempSync(join(tmpdir(), "archgate-upstream-"))
    );
    originalCwd = process.cwd();
    originalCeiling = Bun.env.ARCHGATE_PROJECT_CEILING;
    Bun.env.ARCHGATE_PROJECT_CEILING = tempDir;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    spyOn(console, "error").mockImplementation(() => {});
    spyOn(console, "warn").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    const adrsDir = join(upstreamDir, SUBPATH, "adrs");
    const adrFiles = scaffoldUpstream();

    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    mkdirSync(join(tempDir, ".archgate", "lint"), { recursive: true });
    process.chdir(tempDir);

    spyOn(registryMod, "resolveSource").mockReturnValue({
      kind: "official",
      repoUrl: "https://github.com/archgate/awesome-adrs.git",
      subpath: SUBPATH,
    });
    spyOn(registryMod, "shallowClone").mockResolvedValue(upstreamDir);
    spyOn(registryMod, "detectTarget").mockResolvedValue({
      kind: "pack",
      packMeta: {
        name: "sec",
        version: "1.0.0",
        description: "Security pack for filter tests.",
        maintainers: [{ github: "testuser" }],
        tags: [],
        requires: [],
      },
      adrFiles,
      rulesFiles: [],
      baseDir: adrsDir,
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    restoreEnv("ARCHGATE_PROJECT_CEILING", originalCeiling);
    safeRmSync(tempDir);
    safeRmSync(upstreamDir);
    mock.restore();
  });

  /** Write the pack into upstreamDir; import deletes its clone dir after use. */
  function scaffoldUpstream(): string[] {
    const adrsDir = join(upstreamDir, SUBPATH, "adrs");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(
      join(upstreamDir, SUBPATH, "archgate-pack.yaml"),
      "name: sec\nversion: 1.0.0\ndescription: Security pack for filter tests.\nmaintainers:\n  - github: testuser\ntags: []\nrequires: []"
    );
    return PACK_IDS.map((id) => {
      const p = join(adrsDir, `${id}-rule.md`);
      writeFileSync(p, adrBody(id));
      return p;
    });
  }

  async function runImport(...args: string[]): Promise<void> {
    const parent = new Command("adr").exitOverride();
    registerAdrImportCommand(parent);
    await parent.parseAsync(["node", "adr", "import", SUBPATH, ...args]);
  }

  function output(): string {
    return logSpy.mock.calls.map((c) => String(c[0])).join("\n");
  }

  function localAdrs(): string[] {
    return readdirSync(join(tempDir, ".archgate", "adrs")).filter((f) =>
      f.endsWith(".md")
    );
  }

  test("--exclude skips the listed ADRs in the dry-run preview", async () => {
    await runImport("--dry-run", "--json", "--exclude", "SEC-002");
    const parsed = DryRunJsonSchema.parse(JSON.parse(output()));
    expect(parsed.adrs.map((a) => a.original).sort()).toEqual([
      "SEC-001",
      "SEC-003",
    ]);
  });

  test("--only accepts space- and comma-separated IDs", async () => {
    await runImport("--yes", "--only", "SEC-001,sec-003");
    expect(localAdrs()).toHaveLength(2);
    const manifest = ImportsManifestSchema.parse(
      JSON.parse(
        readFileSync(join(tempDir, ".archgate", "imports.json"), "utf-8")
      )
    );
    expect(Object.values(manifest.imports[0].originalIds ?? {}).sort()).toEqual(
      ["SEC-001", "SEC-003"]
    );
  });

  test("--only and --exclude together are rejected", async () => {
    expect(
      runImport("--dry-run", "--only", "SEC-001", "--exclude", "SEC-002")
    ).rejects.toThrow();
    expect(localAdrs()).toHaveLength(0);
  });

  test("an unknown ID exits 1 without writing files", async () => {
    expect(runImport("--yes", "--exclude", "SEC-999")).rejects.toThrow(
      "process.exit"
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(localAdrs()).toHaveLength(0);
  });

  test("excluding every ADR prints an empty JSON result", async () => {
    await runImport("--yes", "--json", "--exclude", ...PACK_IDS);
    expect(JSON.parse(output())).toEqual({ imported: [] });
  });

  test("an unknown ID fails even when the source has no ADRs", async () => {
    spyOn(registryMod, "detectTarget").mockResolvedValue({
      kind: "pack",
      packMeta: {
        name: "sec",
        version: "1.0.0",
        description: "Security pack for filter tests.",
        maintainers: [{ github: "testuser" }],
        tags: [],
        requires: [],
      },
      adrFiles: [],
      rulesFiles: [],
      baseDir: join(upstreamDir, SUBPATH, "adrs"),
    });
    expect(runImport("--yes", "--only", "SEC-999")).rejects.toThrow(
      "process.exit"
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("excluding every ADR writes nothing", async () => {
    await runImport("--yes", "--exclude", ...PACK_IDS);
    expect(output()).toContain("No ADRs left to import");
    expect(localAdrs()).toHaveLength(0);
  });

  test("sync pairs a filtered import with the right upstream files", async () => {
    await runImport("--yes", "--exclude", "SEC-001");
    logSpy.mockClear();
    scaffoldUpstream();

    const parent = new Command("adr").exitOverride();
    registerAdrSyncCommand(parent);
    await parent.parseAsync(["node", "adr", "sync", "--check", "--json"]);

    const parsed = SyncJsonSchema.parse(JSON.parse(output()));
    expect(parsed.checked).toBe(2);
    expect(parsed.errors).toBe(0);
    expect(parsed.withChanges).toBe(0);
  });
});
