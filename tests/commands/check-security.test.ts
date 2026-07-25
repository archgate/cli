// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadRuleAdrs } from "../../src/engine/loader";
import { runChecks } from "../../src/engine/runner";

/**
 * Whether this platform/account can create a link of the given kind. Windows
 * allows directory junctions unprivileged but needs elevation for file
 * symlinks, so the two are probed separately.
 */
function canLink(kind: "dir" | "file"): boolean {
  const probe = mkdtempSync(join(tmpdir(), "archgate-linkprobe-"));
  try {
    if (kind === "dir") {
      symlinkSync(probe, join(probe, "link"), "junction");
    } else {
      writeFileSync(join(probe, "f.txt"), "x");
      symlinkSync(join(probe, "f.txt"), join(probe, "link.txt"));
    }
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

const DIR_LINKS = canLink("dir");
const FILE_LINKS = canLink("file");

describe("check command security", () => {
  let tempDir: string;
  let adrsDir: string;
  let outsideDirs: string[];

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-check-sec-"));
    adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    mkdirSync(join(tempDir, "src"), { recursive: true });
    outsideDirs = [];
  });

  // Cleanup runs here, not after each assertion: a failing expect() throws
  // immediately, so a trailing rmSync would be skipped and leak the dir.
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    for (const dir of outsideDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** A temp directory outside the project root, removed in afterEach. */
  function makeOutsideDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "archgate-outside-"));
    outsideDirs.push(dir);
    return dir;
  }

  const adrTemplate = (id: string) =>
    `---\nid: ${id}\ntitle: Security Test\ndomain: general\nrules: true\n---\n`;

  function writeAdrAndRule(id: string, ruleCode: string): void {
    writeFileSync(join(adrsDir, `${id}-sec.md`), adrTemplate(id));
    // Wrap rule code with required syntax conventions
    const wrapped =
      `/// <reference path="../rules.d.ts" />\n\n` +
      ruleCode.trimEnd().replace(/\};\s*$/u, "} satisfies RuleSet;\n");
    writeFileSync(join(adrsDir, `${id}-sec.rules.ts`), wrapped);
  }

  test("blocks readFile path traversal via on-disk rule", async () => {
    writeAdrAndRule(
      "SEC-001",
      `export default {
  rules: {
    "steal-file": {
      description: "Attempt to read file outside project",
      async check(ctx) {
        await ctx.readFile("../../etc/passwd");
      },
    },
  },
};
`
    );

    const loaded = await loadRuleAdrs(tempDir);
    const result = await runChecks(tempDir, loaded);
    expect(result.results[0].error).toContain("access denied");
  });

  test("blocks readJSON path traversal via on-disk rule", async () => {
    writeAdrAndRule(
      "SEC-002",
      `export default {
  rules: {
    "steal-json": {
      description: "Attempt to read JSON outside project",
      async check(ctx) {
        await ctx.readJSON("../../../package.json");
      },
    },
  },
};
`
    );

    const loaded = await loadRuleAdrs(tempDir);
    const result = await runChecks(tempDir, loaded);
    expect(result.results[0].error).toContain("access denied");
  });

  test("blocks grep on file outside project", async () => {
    writeAdrAndRule(
      "SEC-003",
      `export default {
  rules: {
    "grep-outside": {
      description: "Attempt to grep file outside project",
      async check(ctx) {
        await ctx.grep("../../../etc/hosts", /localhost/);
      },
    },
  },
};
`
    );

    const loaded = await loadRuleAdrs(tempDir);
    const result = await runChecks(tempDir, loaded);
    expect(result.results[0].error).toContain("access denied");
  });

  test("blocks glob with traversal pattern", async () => {
    writeAdrAndRule(
      "SEC-004",
      `export default {
  rules: {
    "glob-escape": {
      description: "Attempt to glob outside project",
      async check(ctx) {
        await ctx.glob("../../**/*.env");
      },
    },
  },
};
`
    );

    const loaded = await loadRuleAdrs(tempDir);
    const result = await runChecks(tempDir, loaded);
    expect(result.results[0].error).toContain("access denied");
  });

  test("blocks grepFiles with traversal pattern", async () => {
    writeAdrAndRule(
      "SEC-005",
      `export default {
  rules: {
    "grepfiles-escape": {
      description: "Attempt to grepFiles outside project",
      async check(ctx) {
        await ctx.grepFiles(/SECRET/, "../**/*.env");
      },
    },
  },
};
`
    );

    const loaded = await loadRuleAdrs(tempDir);
    const result = await runChecks(tempDir, loaded);
    expect(result.results[0].error).toContain("access denied");
  });

  test.skipIf(!FILE_LINKS)(
    "blocks symlink to file outside project",
    async () => {
      const outsideDir = makeOutsideDir();
      writeFileSync(join(outsideDir, "secret.txt"), "sensitive data");
      symlinkSync(
        join(outsideDir, "secret.txt"),
        join(tempDir, "src", "linked.txt")
      );

      writeAdrAndRule(
        "SEC-006",
        `export default {
  rules: {
    "read-symlink": {
      description: "Attempt to read symlinked file",
      async check(ctx) {
        await ctx.readFile("src/linked.txt");
      },
    },
  },
};
`
      );

      const loaded = await loadRuleAdrs(tempDir);
      const result = await runChecks(tempDir, loaded);
      expect(result.results[0].error).toContain("symbolic link");
    }
  );

  test.skipIf(!DIR_LINKS)(
    "blocks reads that tunnel out through a symlinked ancestor directory",
    async () => {
      // The leaf here is an ordinary file — only an ANCESTOR is the symlink, so
      // a leaf-only lstat reports "not a link" while the OS still resolves the
      // real path outside the project and reads it.
      const outsideDir = makeOutsideDir();
      writeFileSync(join(outsideDir, "secret.txt"), "sensitive data");
      // "junction" is ignored on POSIX; on Windows it needs no elevation and
      // lstat reports it as a symlink, so this runs on every platform.
      symlinkSync(outsideDir, join(tempDir, "src", "linkdir"), "junction");

      writeAdrAndRule(
        "SEC-007",
        `export default {
  rules: {
    "read-through-symlinked-dir": {
      description: "Attempt to read a real file via a symlinked parent",
      async check(ctx) {
        await ctx.readFile("src/linkdir/secret.txt");
      },
    },
  },
};
`
      );

      const loaded = await loadRuleAdrs(tempDir);
      const result = await runChecks(tempDir, loaded);
      expect(result.results[0].error).toContain("access denied");
      expect(result.results[0].error).toContain("symbolic link");
    }
  );

  test("allows reads under real nested directories (no false positives)", async () => {
    // Guards the ancestor walk against over-rejecting: a deep, entirely real
    // directory chain must still be readable.
    mkdirSync(join(tempDir, "src", "a", "b", "c"), { recursive: true });
    writeFileSync(join(tempDir, "src", "a", "b", "c", "deep.ts"), "export {};");

    writeAdrAndRule(
      "SEC-008",
      `export default {
  rules: {
    "read-deep-real-path": {
      description: "Read a file nested under real directories",
      async check(ctx) {
        const content = await ctx.readFile("src/a/b/c/deep.ts");
        if (!content.includes("export")) {
          ctx.report.violation({ message: "unexpected content" });
        }
      },
    },
  },
};
`
    );

    const loaded = await loadRuleAdrs(tempDir);
    const result = await runChecks(tempDir, loaded);
    expect(result.results[0].error).toBeUndefined();
    expect(result.results[0].violations).toHaveLength(0);
  });

  test("allows legitimate file reads within project", async () => {
    writeFileSync(join(tempDir, "src", "app.ts"), "export const x = 1;\n");

    writeAdrAndRule(
      "SEC-007",
      `export default {
  rules: {
    "legit-read": {
      description: "Legitimate file read within project",
      async check(ctx) {
        const content = await ctx.readFile("src/app.ts");
        if (!content.includes("export")) {
          ctx.report.violation({ message: "Missing export" });
        }
      },
    },
  },
};
`
    );

    const loaded = await loadRuleAdrs(tempDir);
    const result = await runChecks(tempDir, loaded);
    expect(result.results[0].error).toBeUndefined();
    expect(result.results[0].violations).toHaveLength(0);
  });

  test("allows legitimate glob within project", async () => {
    writeFileSync(join(tempDir, "src", "a.ts"), "");
    writeFileSync(join(tempDir, "src", "b.ts"), "");

    writeAdrAndRule(
      "SEC-008",
      `export default {
  rules: {
    "legit-glob": {
      description: "Legitimate glob within project",
      async check(ctx) {
        const files = await ctx.glob("src/**/*.ts");
        if (files.length === 0) {
          ctx.report.violation({ message: "No files found" });
        }
      },
    },
  },
};
`
    );

    const loaded = await loadRuleAdrs(tempDir);
    const result = await runChecks(tempDir, loaded);
    expect(result.results[0].error).toBeUndefined();
    expect(result.results[0].violations).toHaveLength(0);
  });

  test("blocks absolute path in readFile", async () => {
    writeAdrAndRule(
      "SEC-009",
      `export default {
  rules: {
    "abs-read": {
      description: "Attempt absolute path read",
      async check(ctx) {
        await ctx.readFile("/etc/passwd");
      },
    },
  },
};
`
    );

    const loaded = await loadRuleAdrs(tempDir);
    const result = await runChecks(tempDir, loaded);
    expect(result.results[0].error).toContain("access denied");
  });

  test("blocks absolute glob pattern", async () => {
    writeAdrAndRule(
      "SEC-010",
      `export default {
  rules: {
    "abs-glob": {
      description: "Attempt absolute glob",
      async check(ctx) {
        await ctx.glob("/tmp/**/*");
      },
    },
  },
};
`
    );

    const loaded = await loadRuleAdrs(tempDir);
    const result = await runChecks(tempDir, loaded);
    expect(result.results[0].error).toContain("access denied");
  });
});
