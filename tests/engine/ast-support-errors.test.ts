// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

import {
  interpreterNotFoundError,
  probeInterpreter,
  writeTempSourceFile,
} from "../../src/engine/ast-support";

// Failure paths of the ctx.ast() support helpers; the happy paths and the
// interpreter end-to-end programs live in ast-support.test.ts.

/** Placeholder callback for a timer whose only purpose is a handle to clear. */
function noop(): void {
  // Intentionally empty.
}

describe("interpreterNotFoundError", () => {
  test.each<["python" | "ruby", string, string]>([
    ["python", "Python", "src/app.py"],
    ["ruby", "Ruby", "src/app.rb"],
  ])(
    "names the %s interpreter, candidates and path",
    (language, label, path) => {
      const err = interpreterNotFoundError(language, ["a", "b"], path);

      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain(`${label} interpreter not found on PATH`);
      expect(err.message).toContain("(tried: a, b)");
      expect(err.message).toContain(`ctx.ast("${path}", "${language}")`);
    }
  );
});

describe("probeInterpreter timeout", () => {
  /**
   * Fire the probe's own 5s timer synchronously so the race resolves to
   * "timeout" deterministically, without holding the suite for five seconds.
   * Every other delay passes through to the real timer.
   */
  function installImmediateProbeTimer(): () => void {
    const realSetTimeout = globalThis.setTimeout;
    const spy = spyOn(globalThis, "setTimeout");
    // The replacement deliberately does not match setTimeout's overloads —
    // it forwards everything it does not intercept to the real one.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    spy.mockImplementation(((fn: () => void, ms?: number) => {
      if (ms !== 5_000) return realSetTimeout(fn, ms);
      fn();
      return realSetTimeout(noop, 0);
    }) as unknown as typeof setTimeout);
    return () => {
      spy.mockRestore();
    };
  }

  /**
   * Wrap `Bun.spawn` so the probe still spawns its real subprocess while every
   * `kill()` made against that subprocess is counted. Counting is the only way
   * to observe the cleanup — the timed-out candidate is otherwise indistinguishable
   * from one that simply exited non-zero.
   */
  function countProbeKills(): { kills: () => number; restore: () => void } {
    const realSpawn = Bun.spawn;
    let killCount = 0;
    const spy = spyOn(Bun, "spawn");
    // The wrapper forwards to the real spawn; Bun.spawn's overload set is not
    // expressible in a single mock implementation signature.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    spy.mockImplementation(((...args: Parameters<typeof Bun.spawn>) => {
      const proc = realSpawn(...args);
      const realKill = proc.kill.bind(proc);
      proc.kill = (...killArgs: Parameters<typeof proc.kill>): void => {
        killCount++;
        realKill(...killArgs);
      };
      return proc;
    }) as unknown as typeof Bun.spawn);
    return {
      kills: () => killCount,
      restore: () => {
        spy.mockRestore();
      },
    };
  }

  test("kills a candidate that outlives the probe timeout and moves on", async () => {
    // process.execPath is the running bun binary — it exists and would
    // normally answer `--version`, so only the timeout can reject it.
    const restoreTimer = installImmediateProbeTimer();
    const spawns = countProbeKills();

    try {
      expect(await probeInterpreter([process.execPath])).toBeNull();
      // The subprocess is terminated rather than left running for the rest of
      // the check.
      expect(spawns.kills()).toBe(1);
    } finally {
      spawns.restore();
      restoreTimer();
    }
  });
});

describe("writeTempSourceFile", () => {
  test("removes the private temp dir when the file cannot be created", () => {
    const realTmpdir = os.tmpdir();
    const sandbox = mkdtempSync(join(realTmpdir, "archgate-ast-sandbox-"));
    const tmpdirSpy = spyOn(os, "tmpdir").mockReturnValue(sandbox);

    try {
      // An extension carrying a directory component aims the exclusive
      // create at a path whose parent was never made, so the write fails
      // after mkdtempSync has already created the private directory.
      expect(() =>
        writeTempSourceFile("print(1)", "/missing/source.py")
      ).toThrow();
      expect(readdirSync(sandbox)).toEqual([]);
    } finally {
      tmpdirSpy.mockRestore();
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
