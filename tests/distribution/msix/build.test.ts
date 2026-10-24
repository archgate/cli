// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  findMakeAppx,
  MSIX_ARTIFACT_NAME,
  parseArgs,
  readManifestVersion,
  toPackageVersion,
  stagePackage,
} from "../../../distribution/msix/build";
import packageJson from "../../../package.json";

const SOURCE_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "distribution",
  "msix"
);

function manifest(version: string): string {
  return `<Package><Identity Name="N" Publisher="CN=P" Version="${version}" /></Package>`;
}

describe("MSIX_ARTIFACT_NAME", () => {
  test("names the win32-x64 package", () => {
    expect(MSIX_ARTIFACT_NAME).toBe("archgate-win32-x64.msix");
  });
});

describe("toPackageVersion", () => {
  test.each([
    ["0.60.0", "1.60.0.0"],
    ["0.0.1", "1.0.1.0"],
    ["1.0.0", "2.0.0.0"],
    ["2.3.4", "3.3.4.0"],
  ])("maps release %p to package version %p", (release, packageVersion) => {
    expect(toPackageVersion(release)).toBe(packageVersion);
  });
});

describe("readManifestVersion", () => {
  test("undoes the major offset and drops the reserved fourth part", () => {
    expect(readManifestVersion(manifest("1.2.3.0"))).toBe("0.2.3");
  });

  test("reads the version when Identity spans several lines", () => {
    const xml = '<Identity\n  Name="N"\n  Version="10.20.30.0"\n  />';
    expect(readManifestVersion(xml)).toBe("9.20.30");
  });

  test.each(["1.2.3", "1.2.3.4", "v1.2.3.0", "0.2.3.0"])(
    "rejects the version %p",
    (version) => {
      expect(() => readManifestVersion(manifest(version))).toThrow("X >= 1");
    }
  );

  test("the committed manifest targets Windows 10 version 1903", async () => {
    const xml = await Bun.file(join(SOURCE_DIR, "AppxManifest.xml")).text();
    expect(/MinVersion="([^"]+)"/u.exec(xml)?.[1]).toBe("10.0.18362.0");
  });

  test("the committed manifest carries the package.json version", async () => {
    const xml = await Bun.file(join(SOURCE_DIR, "AppxManifest.xml")).text();
    expect(readManifestVersion(xml)).toBe(packageJson.version);
  });
});

describe("with a temp directory", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-msix-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("findMakeAppx", () => {
    function installSdk(version: string, withMakeAppx = true): string {
      const dir = join(tempDir, version, "x64");
      mkdirSync(dir, { recursive: true });
      const exe = join(dir, "makeappx.exe");
      if (withMakeAppx) writeFileSync(exe, "");
      return exe;
    }

    test("returns null when the SDK directory is absent", async () => {
      expect(await findMakeAppx(join(tempDir, "missing"))).toBeNull();
    });

    test("picks the newest SDK by numeric version", async () => {
      installSdk("10.0.9000.0");
      const newest = installSdk("10.0.26100.0");
      expect(await findMakeAppx(tempDir)).toBe(newest);
    });

    test("skips an SDK that ships no makeappx.exe", async () => {
      const older = installSdk("10.0.19041.0");
      installSdk("10.0.26100.0", false);
      expect(await findMakeAppx(tempDir)).toBe(older);
    });

    test("ignores the unversioned architecture directories", async () => {
      mkdirSync(join(tempDir, "x64"), { recursive: true });
      writeFileSync(join(tempDir, "x64", "makeappx.exe"), "");
      expect(await findMakeAppx(tempDir)).toBeNull();
    });
  });

  describe("stagePackage", () => {
    let binary: string;
    let stagingDir: string;

    beforeEach(() => {
      binary = join(tempDir, "archgate-win32-x64.exe");
      writeFileSync(binary, "binary");
      stagingDir = join(tempDir, "staging");
    });

    test("lays out the executable, manifest and logos", async () => {
      await stagePackage({
        binary,
        sourceDir: SOURCE_DIR,
        stagingDir,
        expectedVersion: packageJson.version,
      });

      expect(await Bun.file(join(stagingDir, "archgate.exe")).text()).toBe(
        "binary"
      );
      expect(existsSync(join(stagingDir, "AppxManifest.xml"))).toBe(true);
      expect(existsSync(join(stagingDir, "Assets", "StoreLogo.png"))).toBe(
        true
      );
    });

    test("clears files left by an earlier build", async () => {
      mkdirSync(stagingDir, { recursive: true });
      writeFileSync(join(stagingDir, "stale.txt"), "stale");

      await stagePackage({
        binary,
        sourceDir: SOURCE_DIR,
        stagingDir,
        expectedVersion: packageJson.version,
      });

      expect(existsSync(join(stagingDir, "stale.txt"))).toBe(false);
    });

    test("refuses a manifest behind package.json", async () => {
      expect(
        stagePackage({
          binary,
          sourceDir: SOURCE_DIR,
          stagingDir,
          expectedVersion: "999.0.0",
        })
      ).rejects.toThrow("does not match package.json version 999.0.0");
    });

    test("refuses a missing binary", async () => {
      expect(
        stagePackage({
          binary: join(tempDir, "absent.exe"),
          sourceDir: SOURCE_DIR,
          stagingDir,
          expectedVersion: packageJson.version,
        })
      ).rejects.toThrow("Binary not found");
    });
  });
});

describe("parseArgs", () => {
  test("defaults to the release binary and dist/msix", () => {
    expect(parseArgs([])).toEqual({
      binary: join("dist", "archgate-win32-x64.exe"),
      outDir: join("dist", "msix"),
      stageOnly: false,
    });
  });

  test("accepts every option", () => {
    expect(
      parseArgs([
        "--binary",
        "a.exe",
        "--out-dir",
        "out",
        "--makeappx",
        "m.exe",
        "--stage-only",
      ])
    ).toEqual({
      binary: "a.exe",
      outDir: "out",
      makeappx: "m.exe",
      stageOnly: true,
    });
  });

  test("rejects an unknown option", () => {
    expect(() => parseArgs(["--nope"])).toThrow();
  });
});
