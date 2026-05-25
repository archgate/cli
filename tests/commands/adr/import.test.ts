// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import {
  existsSync,
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

import { parsePackMetadata } from "../../../src/formats/pack";

// Module mock — declared before importing so shallowClone never hits the network.
// Provides explicit implementations instead of `require()` + spread of the mocked
// module, which is unreliable on macOS ARM64 (Bun mock.module interop issue).
let fakeCloneDir: string = "";
mock.module("../../../src/helpers/registry", () => ({
  resolveSource(input: string) {
    const atIdx = input.lastIndexOf("@");
    const base = atIdx <= 0 ? input : input.slice(0, atIdx);
    const ref = atIdx <= 0 ? undefined : input.slice(atIdx + 1);
    if (base.startsWith("packs/")) {
      return {
        kind: "official",
        repoUrl: "https://github.com/archgate/awesome-adrs.git",
        ref,
        subpath: base,
      };
    }
    const segments = base.split("/");
    if (segments.length >= 3) {
      const [org, repo, ...rest] = segments;
      return {
        kind: "github-repo",
        repoUrl: `https://github.com/${org}/${repo}.git`,
        ref,
        subpath: rest.join("/"),
      };
    }
    throw new Error(`Cannot resolve source "${input}".`);
  },
  async detectTarget(cloneDir: string, subpath: string) {
    const fullPath = join(cloneDir, subpath);
    const packYaml = join(fullPath, "archgate-pack.yaml");
    if (existsSync(packYaml)) {
      const raw = await Bun.file(packYaml).text();
      const packMeta = parsePackMetadata(raw);
      const adrsDir = join(fullPath, "adrs");
      const entries = existsSync(adrsDir) ? readdirSync(adrsDir) : [];
      return {
        kind: "pack",
        packMeta,
        adrFiles: entries
          .filter((f: string) => f.endsWith(".md"))
          .map((f: string) => join(adrsDir, f)),
        rulesFiles: entries
          .filter((f: string) => f.endsWith(".rules.ts"))
          .map((f: string) => join(adrsDir, f)),
        baseDir: adrsDir,
      };
    }
    const mdPath = fullPath.endsWith(".md") ? fullPath : `${fullPath}.md`;
    if (existsSync(mdPath)) {
      const rulesPath = mdPath.replace(/\.md$/u, ".rules.ts");
      return {
        kind: "single-adr",
        adrFile: mdPath,
        rulesFile: existsSync(rulesPath) ? rulesPath : null,
        baseDir: join(mdPath, ".."),
      };
    }
    throw new Error(
      `Cannot detect import target at "${subpath}". Expected archgate-pack.yaml (pack) or a .md file (single ADR).`
    );
  },
  shallowClone: () => Promise.resolve(fakeCloneDir),
}));

import { registerAdrImportCommand } from "../../../src/commands/adr/import";
import { safeRmSync } from "../../test-utils";

const PACK_YAML =
  "name: test-pack\nversion: 0.1.0\ndescription: A test pack for import testing.\nmaintainers:\n  - github: testuser\ntags: []\nrequires: []";

const ADR_1 =
  "---\nid: TP-001\ntitle: Test Rule\ndomain: architecture\nrules: true\n---\n\n## Context\nTest ADR.";

const ADR_2 =
  "---\nid: TP-002\ntitle: Another Rule\ndomain: architecture\nrules: false\n---\n\n## Context\nAnother test ADR.";

const RULES_TS =
  "/// <reference path='../rules.d.ts' />\nexport default { rules: {} } satisfies RuleSet;\n";

describe("registerAdrImportCommand", () => {
  const sub = () => {
    const p = new Command("adr");
    registerAdrImportCommand(p);
    return p.commands.find((c) => c.name() === "import")!;
  };
  const hasOpt = (long: string) => sub().options.find((o) => o.long === long);

  test("registers 'import' as a subcommand", () => expect(sub()).toBeDefined());
  test("has a description", () => expect(sub().description()).toBeTruthy());
  test("accepts --yes option", () => expect(hasOpt("--yes")).toBeDefined());
  test("accepts --json option", () => expect(hasOpt("--json")).toBeDefined());
  test("accepts --dry-run option", () =>
    expect(hasOpt("--dry-run")).toBeDefined());
  test("accepts --list option", () => expect(hasOpt("--list")).toBeDefined());
  test("requires <source...> argument", () => {
    const s = sub();
    expect(s.registeredArguments.length).toBeGreaterThanOrEqual(1);
    expect(s.registeredArguments[0].name()).toBe("source");
  });
});

describe("import action handler", () => {
  let tempDir: string;
  let upstreamDir: string;
  let originalCwd: string;
  let logSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // realpathSync normalizes macOS /var → /private/var symlink so paths
    // match what process.cwd() and mock.module resolve to at runtime.
    tempDir = realpathSync(
      mkdtempSync(join(tmpdir(), "archgate-import-test-"))
    );
    upstreamDir = realpathSync(
      mkdtempSync(join(tmpdir(), "archgate-upstream-"))
    );
    originalCwd = process.cwd();
    Bun.env.ARCHGATE_PROJECT_CEILING = tempDir;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    fakeCloneDir = upstreamDir;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    delete Bun.env.ARCHGATE_PROJECT_CEILING;
    safeRmSync(tempDir);
    safeRmSync(upstreamDir);
    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  function scaffoldProject(): void {
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    mkdirSync(join(tempDir, ".archgate", "lint"), { recursive: true });
  }

  function scaffoldUpstreamPack(): void {
    const packDir = join(upstreamDir, "packs", "test-pack");
    const adrsDir = join(packDir, "adrs");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(join(packDir, "archgate-pack.yaml"), PACK_YAML);
    writeFileSync(join(adrsDir, "TP-001-test-rule.md"), ADR_1);
    writeFileSync(join(adrsDir, "TP-002-another-rule.md"), ADR_2);
    writeFileSync(join(adrsDir, "TP-001-test-rule.rules.ts"), RULES_TS);
  }

  function scaffoldUpstreamSingleAdr(): void {
    const adrDir = join(upstreamDir, "adrs");
    mkdirSync(adrDir, { recursive: true });
    writeFileSync(join(adrDir, "TP-001-test-rule.md"), ADR_1);
    writeFileSync(join(adrDir, "TP-001-test-rule.rules.ts"), RULES_TS);
  }

  function makeProgram(): Command {
    const parent = new Command("adr").exitOverride();
    registerAdrImportCommand(parent);
    return parent;
  }

  function allOutput(): string {
    return logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
  }

  function writeManifest(imports: unknown[]): void {
    writeFileSync(
      join(tempDir, ".archgate", "imports.json"),
      JSON.stringify({ imports }, null, 2) + "\n"
    );
  }

  test("exits with error when .archgate/ directory is missing", async () => {
    process.chdir(tempDir);
    await expect(
      makeProgram().parseAsync(["node", "adr", "import", "packs/test-pack"])
    ).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("--list prints empty message when no imports exist", async () => {
    scaffoldProject();
    process.chdir(tempDir);
    await makeProgram().parseAsync([
      "node",
      "adr",
      "import",
      "--list",
      "dummy",
    ]);
    expect(allOutput()).toContain("No ADRs have been imported yet.");
  });

  test("--list prints imported ADR info when imports exist", async () => {
    scaffoldProject();
    process.chdir(tempDir);
    writeManifest([
      {
        source: "packs/test-pack",
        version: "0.1.0",
        importedAt: "2026-01-15T12:00:00.000Z",
        adrIds: ["ARCH-001", "ARCH-002"],
      },
    ]);
    await makeProgram().parseAsync([
      "node",
      "adr",
      "import",
      "--list",
      "dummy",
    ]);
    const output = allOutput();
    expect(output).toContain("packs/test-pack");
    expect(output).toContain("v0.1.0");
    expect(output).toContain("2 ADR(s)");
    expect(output).toContain("ARCH-001");
    expect(output).toContain("ARCH-002");
  });

  test("--list --json outputs JSON manifest", async () => {
    scaffoldProject();
    process.chdir(tempDir);
    writeManifest([
      {
        source: "packs/test-pack",
        version: "0.1.0",
        importedAt: "2026-01-15T12:00:00.000Z",
        adrIds: ["ARCH-001"],
      },
    ]);
    await makeProgram().parseAsync([
      "node",
      "adr",
      "import",
      "--list",
      "--json",
      "dummy",
    ]);
    const parsed = JSON.parse(allOutput());
    expect(parsed.imports).toHaveLength(1);
    expect(parsed.imports[0].source).toBe("packs/test-pack");
    expect(parsed.imports[0].adrIds).toEqual(["ARCH-001"]);
  });

  test("--dry-run previews ADRs without writing files", async () => {
    scaffoldProject();
    scaffoldUpstreamPack();
    process.chdir(tempDir);
    await makeProgram().parseAsync([
      "node",
      "adr",
      "import",
      "--dry-run",
      "packs/test-pack",
    ]);
    const output = allOutput();
    expect(output).toContain("TP-001");
    expect(output).toContain("TP-002");
    expect(output).toContain("ARCH-");
    expect(output).toContain("Dry run");
    // No files written
    const files = readdirSync(join(tempDir, ".archgate", "adrs"));
    expect(files.filter((f) => f.endsWith(".md"))).toHaveLength(0);
  });

  test("--dry-run --json outputs JSON preview", async () => {
    scaffoldProject();
    scaffoldUpstreamPack();
    process.chdir(tempDir);
    await makeProgram().parseAsync([
      "node",
      "adr",
      "import",
      "--dry-run",
      "--json",
      "packs/test-pack",
    ]);
    const parsed = JSON.parse(allOutput());
    expect(parsed.dryRun).toBe(true);
    expect(parsed.adrs).toHaveLength(2);
    // Sort by original ID to avoid filesystem ordering differences across platforms
    const sortedAdrs = [...parsed.adrs].sort(
      (a: { original: string }, b: { original: string }) =>
        a.original.localeCompare(b.original)
    );
    expect(sortedAdrs[0].original).toBe("TP-001");
    expect(sortedAdrs[1].original).toBe("TP-002");
    expect(sortedAdrs[0].newId).toMatch(/^ARCH-\d{3}$/u);
    expect(sortedAdrs[1].newId).toMatch(/^ARCH-\d{3}$/u);
  });

  test("--yes imports ADR files, remaps IDs, and assigns sequential numbers", async () => {
    scaffoldProject();
    scaffoldUpstreamPack();
    process.chdir(tempDir);
    await makeProgram().parseAsync([
      "node",
      "adr",
      "import",
      "--yes",
      "packs/test-pack",
    ]);
    const adrsDir = join(tempDir, ".archgate", "adrs");
    const mdFiles = readdirSync(adrsDir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    expect(mdFiles).toHaveLength(2);
    expect(mdFiles[0]).toMatch(/^ARCH-001-/u);
    expect(mdFiles[1]).toMatch(/^ARCH-002-/u);

    // Frontmatter IDs are rewritten to match filenames
    for (const file of mdFiles) {
      const content = readFileSync(join(adrsDir, file), "utf-8");
      expect(content).not.toContain("id: TP-");
      const prefix = file.match(/^(ARCH-\d{3})/u)![1];
      expect(content).toContain(`id: ${prefix}`);
    }

    // Human-readable success message
    expect(allOutput()).toContain("Imported 2 ADR(s)");
  });

  test("--yes imports rules files alongside ADRs and writes rules.d.ts shim", async () => {
    scaffoldProject();
    scaffoldUpstreamPack();
    process.chdir(tempDir);
    await makeProgram().parseAsync([
      "node",
      "adr",
      "import",
      "--yes",
      "packs/test-pack",
    ]);
    const adrsDir = join(tempDir, ".archgate", "adrs");
    const rulesFiles = readdirSync(adrsDir).filter((f) =>
      f.endsWith(".rules.ts")
    );
    // TP-001 has a companion .rules.ts, TP-002 does not
    expect(rulesFiles).toHaveLength(1);
    expect(rulesFiles[0]).toMatch(/^ARCH-\d{3}-.*\.rules\.ts$/u);
    // rules.d.ts shim created
    expect(existsSync(join(tempDir, ".archgate", "rules.d.ts"))).toBe(true);
  });

  test("--yes creates imports.json manifest with import metadata", async () => {
    scaffoldProject();
    scaffoldUpstreamPack();
    process.chdir(tempDir);
    await makeProgram().parseAsync([
      "node",
      "adr",
      "import",
      "--yes",
      "packs/test-pack",
    ]);
    const importsPath = join(tempDir, ".archgate", "imports.json");
    expect(existsSync(importsPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(importsPath, "utf-8"));
    expect(manifest.imports).toHaveLength(1);
    expect(manifest.imports[0].source).toBe("packs/test-pack");
    expect(manifest.imports[0].version).toBe("0.1.0");
    expect(manifest.imports[0].adrIds).toHaveLength(2);
    for (const id of manifest.imports[0].adrIds) {
      expect(id).toMatch(/^ARCH-\d{3}$/u);
    }
    expect(() => new Date(manifest.imports[0].importedAt)).not.toThrow();
  });

  test("--yes appends to existing imports.json without overwriting", async () => {
    scaffoldProject();
    scaffoldUpstreamPack();
    process.chdir(tempDir);
    writeManifest([
      {
        source: "packs/other-pack",
        version: "1.0.0",
        importedAt: "2026-01-01T00:00:00.000Z",
        adrIds: ["GEN-001"],
      },
    ]);
    await makeProgram().parseAsync([
      "node",
      "adr",
      "import",
      "--yes",
      "packs/test-pack",
    ]);
    const manifest = JSON.parse(
      readFileSync(join(tempDir, ".archgate", "imports.json"), "utf-8")
    );
    expect(manifest.imports).toHaveLength(2);
    expect(manifest.imports[0].source).toBe("packs/other-pack");
    expect(manifest.imports[1].source).toBe("packs/test-pack");
  });

  test("assigns IDs that do not collide with existing ADRs", async () => {
    scaffoldProject();
    scaffoldUpstreamPack();
    process.chdir(tempDir);
    const adrsDir = join(tempDir, ".archgate", "adrs");
    writeFileSync(
      join(adrsDir, "ARCH-001-existing.md"),
      "---\nid: ARCH-001\ntitle: Existing\ndomain: architecture\nrules: false\n---\n\n## Context\nExisting.\n"
    );
    await makeProgram().parseAsync([
      "node",
      "adr",
      "import",
      "--yes",
      "packs/test-pack",
    ]);
    const mdFiles = readdirSync(adrsDir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    expect(mdFiles).toHaveLength(3);
    expect(mdFiles[0]).toMatch(/^ARCH-001-existing\.md$/u);
    expect(mdFiles[1]).toMatch(/^ARCH-002-/u);
    expect(mdFiles[2]).toMatch(/^ARCH-003-/u);
  });

  test("--yes --json outputs JSON summary of imported ADRs", async () => {
    scaffoldProject();
    scaffoldUpstreamPack();
    process.chdir(tempDir);
    await makeProgram().parseAsync([
      "node",
      "adr",
      "import",
      "--yes",
      "--json",
      "packs/test-pack",
    ]);
    const parsed = JSON.parse(allOutput());
    expect(parsed.imported).toHaveLength(2);
    // Sort by originalId to avoid filesystem ordering differences across platforms
    const sorted = [...parsed.imported].sort(
      (a: { originalId: string }, b: { originalId: string }) =>
        a.originalId.localeCompare(b.originalId)
    );
    expect(sorted[0].originalId).toBe("TP-001");
    expect(sorted[1].originalId).toBe("TP-002");
    expect(sorted[0].newId).toMatch(/^ARCH-\d{3}$/u);
    expect(sorted[0].title).toBe("Test Rule");
    expect(sorted[1].title).toBe("Another Rule");
  });

  test("--yes imports a single ADR with its rules file", async () => {
    scaffoldProject();
    scaffoldUpstreamSingleAdr();
    process.chdir(tempDir);
    await makeProgram().parseAsync([
      "node",
      "adr",
      "import",
      "--yes",
      "org/repo/adrs/TP-001-test-rule",
    ]);
    const adrsDir = join(tempDir, ".archgate", "adrs");
    const mdFiles = readdirSync(adrsDir).filter((f) => f.endsWith(".md"));
    expect(mdFiles).toHaveLength(1);
    expect(mdFiles[0]).toMatch(/^ARCH-\d{3}-/u);
    const rulesFiles = readdirSync(adrsDir).filter((f) =>
      f.endsWith(".rules.ts")
    );
    expect(rulesFiles).toHaveLength(1);
  });
});
