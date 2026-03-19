import { describe, expect, test } from "bun:test";

import {
  getArtifactInfo,
  getManualInstallHint,
} from "../../src/helpers/binary-upgrade";

describe("getArtifactInfo", () => {
  test("returns artifact info for the current platform", () => {
    const info = getArtifactInfo();

    // Should return non-null for any supported CI platform
    if (info === null) return;

    expect(info.name).toMatch(/^archgate-(darwin-arm64|linux-x64|win32-x64)$/);
    expect(info.ext).toMatch(/^\.(tar\.gz|zip)$/);
    expect(info.binaryName).toMatch(/^archgate(\.exe)?$/);
  });

  test("returns .zip extension for win32", () => {
    const info = getArtifactInfo();
    if (process.platform !== "win32") return;
    expect(info).not.toBeNull();
    expect(info!.ext).toBe(".zip");
    expect(info!.binaryName).toBe("archgate.exe");
    expect(info!.name).toBe("archgate-win32-x64");
  });

  test("returns .tar.gz extension for non-win32", () => {
    const info = getArtifactInfo();
    if (process.platform === "win32") return;
    expect(info).not.toBeNull();
    expect(info!.ext).toBe(".tar.gz");
    expect(info!.binaryName).toBe("archgate");
  });
});

describe("getManualInstallHint", () => {
  test("returns platform-appropriate install command", () => {
    const hint = getManualInstallHint();

    if (process.platform === "win32") {
      expect(hint).toContain("install.ps1");
      expect(hint).toContain("irm");
    } else {
      expect(hint).toContain("install.sh");
      expect(hint).toContain("curl");
    }
  });
});
