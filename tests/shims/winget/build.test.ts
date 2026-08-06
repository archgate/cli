// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  computeSha256,
  PACKAGE_IDENTIFIER,
  parseArgs,
  renderManifest,
  renderManifests,
  SHIM_ARTIFACT_NAME,
} from "../../../shims/winget/build";

const TEMPLATES_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "shims",
  "winget",
  "manifests"
);

const VALUES = {
  sha256: "a98fca384f1f5fa9e4ad69c052dffe7c5cee267041768f2471ee28d16a4b84b0",
};

const MANIFEST_NAMES: string[] = [
  "Archgate.Archgate.yaml",
  "Archgate.Archgate.installer.yaml",
  "Archgate.Archgate.locale.en-US.yaml",
];

describe("SHIM_ARTIFACT_NAME", () => {
  test("targets the win32-x64 shim artifact", () => {
    expect(SHIM_ARTIFACT_NAME).toBe("archgate-shim-win32-x64.exe");
  });
});

describe("renderManifest", () => {
  test("substitutes the checksum", () => {
    expect(renderManifest("InstallerSha256: {{SHA256}}", VALUES)).toBe(
      `InstallerSha256: ${VALUES.sha256.toUpperCase()}`
    );
  });

  test("uppercases the checksum, matching winget convention", () => {
    expect(renderManifest("{{SHA256}}", VALUES)).toBe(
      VALUES.sha256.toUpperCase()
    );
  });

  test("substitutes every occurrence of a repeated placeholder", () => {
    expect(renderManifest("{{SHA256}} {{SHA256}}", VALUES)).toBe(
      `${VALUES.sha256.toUpperCase()} ${VALUES.sha256.toUpperCase()}`
    );
  });

  test("leaves the version alone — it is committed, not rendered", () => {
    expect(renderManifest('PackageVersion: "0.51.0"', VALUES)).toBe(
      'PackageVersion: "0.51.0"'
    );
  });

  test("throws when a placeholder has no value", () => {
    expect(() => renderManifest("Publisher: {{UNKNOWN}}", VALUES)).toThrow(
      "Unresolved manifest placeholder(s): {{UNKNOWN}}"
    );
  });

  test("reports each unresolved placeholder once", () => {
    expect(() => renderManifest("{{ONE}} {{ONE}} {{TWO}}", VALUES)).toThrow(
      "Unresolved manifest placeholder(s): {{ONE}}, {{TWO}}"
    );
  });

  test("leaves manifest text without placeholders untouched", () => {
    expect(renderManifest("ManifestVersion: 1.6.0", VALUES)).toBe(
      "ManifestVersion: 1.6.0"
    );
  });
});

describe("parseArgs", () => {
  test("defaults to dist/winget", () => {
    const options = parseArgs([]);
    expect(options.outDir).toBe(join("dist", "winget"));
    expect(options.manifestsOnly).toBe(false);
  });

  test("reads out-dir and sha256", () => {
    const options = parseArgs(["--out-dir", "out", "--sha256", VALUES.sha256]);
    expect(options.outDir).toBe("out");
    expect(options.sha256).toBe(VALUES.sha256);
  });

  test("rejects an unknown flag", () => {
    expect(() => parseArgs(["--nope"])).toThrow("unknown option '--nope'");
  });

  test("rejects --version, which the manifests now carry themselves", () => {
    expect(() => parseArgs(["--version", "9.9.9"])).toThrow(
      "unknown option '--version'"
    );
  });

  test("requires a checksum when the compile is skipped", () => {
    expect(() => parseArgs(["--manifests-only"])).toThrow(
      "--manifests-only requires --sha256 <hex>"
    );
  });

  test.each(["--out-dir", "--sha256"])("rejects %s with no value", (flag) => {
    expect(() => parseArgs([flag])).toThrow("argument missing");
  });

  test.each([
    ["empty", ""],
    ["too short", "abc"],
    ["non-hex", `${"a".repeat(63)}z`],
    ["too long", `${VALUES.sha256}0`],
    ["trailing newline", `${VALUES.sha256}\n`],
    ["flag-shaped", "--manifests-only"],
  ])("rejects a %s checksum", (_label, sha256) => {
    expect(() => parseArgs(["--sha256", sha256])).toThrow(
      "must be a 64-character hex digest"
    );
  });

  test("accepts an uppercase checksum", () => {
    const options = parseArgs(["--sha256", VALUES.sha256.toUpperCase()]);
    expect(options.sha256).toBe(VALUES.sha256.toUpperCase());
  });
});

describe("computeSha256", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-winget-sha-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("hashes file contents", async () => {
    const file = join(tempDir, "payload.bin");
    await Bun.write(file, "abc");
    expect(await computeSha256(file)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });
});

describe("renderManifests", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-winget-out-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("renders the shipped templates with no placeholder left", async () => {
    const written = await renderManifests({
      templatesDir: TEMPLATES_DIR,
      outDir: tempDir,
      values: VALUES,
    });

    expect(written).toHaveLength(3);

    const contents = await Promise.all(
      written.map(async (path) => Bun.file(path).text())
    );
    expect(contents.join("\n")).not.toContain("{{");
  });

  test("stamps the package identifier into every manifest", async () => {
    const written = await renderManifests({
      templatesDir: TEMPLATES_DIR,
      outDir: tempDir,
      values: VALUES,
    });

    const contents = await Promise.all(
      written.map(async (path) => Bun.file(path).text())
    );

    const missingIdentifier = contents.filter(
      (content) => !content.includes(`PackageIdentifier: ${PACKAGE_IDENTIFIER}`)
    );
    expect(missingIdentifier).toHaveLength(0);
  });

  // The version is committed, so rendering must pass it through untouched.
  // Which version is correct is ARCH-013/shim-version-sync's business, not
  // this test's — asserting a literal here would just duplicate that rule.
  test.each(MANIFEST_NAMES)(
    "carries the source PackageVersion of %s through unchanged",
    async (name) => {
      await renderManifests({
        templatesDir: TEMPLATES_DIR,
        outDir: tempDir,
        values: VALUES,
      });

      const versionLine = /^PackageVersion:.*$/mu;
      const source = versionLine.exec(
        await Bun.file(join(TEMPLATES_DIR, name)).text()
      )?.[0];
      const rendered = versionLine.exec(
        await Bun.file(join(tempDir, name)).text()
      )?.[0];

      expect(source).toBeDefined();
      expect(rendered).toBe(source);
    }
  );

  test("writes one manifest per template", async () => {
    const written = await renderManifests({
      templatesDir: TEMPLATES_DIR,
      outDir: tempDir,
      values: VALUES,
    });

    const templates = (await readdir(TEMPLATES_DIR)).filter((name) =>
      name.endsWith(".yaml")
    );
    expect(written).toHaveLength(templates.length);
    expect(await readdir(tempDir)).toHaveLength(templates.length);
  });

  test("throws when the template directory has no manifests", async () => {
    const empty = join(tempDir, "empty");
    await Bun.write(join(empty, ".keep"), "");
    expect(
      renderManifests({
        templatesDir: empty,
        outDir: join(tempDir, "out"),
        values: VALUES,
      })
    ).rejects.toThrow("No manifest templates found");
  });
});
