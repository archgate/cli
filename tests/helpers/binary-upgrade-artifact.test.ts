// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { getArtifactInfo } from "../../src/helpers/binary-upgrade";

/**
 * Run `fn` while `process.platform` and `process.arch` report the given values,
 * restoring the original property descriptors afterwards. Bun defines both as
 * writable data properties, which is what makes a release-target matrix
 * runnable from any single OS.
 */
function withSimulatedTarget<T>(
  platform: string,
  arch: string,
  fn: () => T
): T {
  const platformDesc = Object.getOwnPropertyDescriptor(process, "platform")!;
  const archDesc = Object.getOwnPropertyDescriptor(process, "arch")!;
  Object.defineProperty(process, "platform", {
    ...platformDesc,
    value: platform,
  });
  Object.defineProperty(process, "arch", { ...archDesc, value: arch });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", platformDesc);
    Object.defineProperty(process, "arch", archDesc);
  }
}

describe("getArtifactInfo", () => {
  test.skipIf(getArtifactInfo() === null)(
    "returns artifact info for the current platform",
    () => {
      const info = getArtifactInfo();

      expect(info).not.toBeNull();
      expect(info!.name).toMatch(
        /^archgate-(darwin-arm64|linux-x64|win32-x64)$/u
      );
      expect(info!.ext).toMatch(/^\.(tar\.gz|zip)$/u);
      expect(info!.binaryName).toMatch(/^archgate(\.exe)?$/u);
    }
  );

  // Every published release target, resolved from a single runner. Gating each
  // one on the real OS would leave two of the three uncovered on both CI
  // platforms, since a skipped test counts for neither.
  const targets = [
    ["darwin", "arm64", "archgate-darwin-arm64", ".tar.gz", "archgate"],
    ["linux", "x64", "archgate-linux-x64", ".tar.gz", "archgate"],
    ["win32", "x64", "archgate-win32-x64", ".zip", "archgate.exe"],
  ] as const;

  test.each(targets)(
    "resolves %s/%s to %s",
    (platform, arch, name, ext, binaryName) => {
      const info = withSimulatedTarget(platform, arch, getArtifactInfo);

      expect(info).toEqual({ name, ext, binaryName });
    }
  );

  // A supported OS on an unpublished architecture, and an OS with no release
  // at all — both fall through to the "no artifact" result that `upgrade`
  // turns into a manual-install hint.
  const unsupportedTargets = [
    ["darwin", "x64"],
    ["linux", "arm64"],
    ["win32", "arm64"],
    ["freebsd", "x64"],
    ["sunos", "s390x"],
  ] as const;

  test.each(unsupportedTargets)(
    "returns null for the unsupported target %s/%s",
    (platform, arch) => {
      expect(withSimulatedTarget(platform, arch, getArtifactInfo)).toBeNull();
    }
  );
});
