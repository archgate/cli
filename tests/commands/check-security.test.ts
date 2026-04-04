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

describe("check command security", () => {
  let tempDir: string;
  let adrsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-check-sec-"));
    adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    mkdirSync(join(tempDir, "src"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const adrTemplate = (id: string) =>
    `---\nid: ${id}\ntitle: Security Test\ndomain: general\nrules: true\n---\n`;

  function writeAdrAndRule(id: string, ruleCode: string): void {
    writeFileSync(join(adrsDir, `${id}-sec.md`), adrTemplate(id));
    // Wrap rule code with required syntax conventions
    const wrapped =
      `/// <reference path="../rules.d.ts" />\n\n` +
      ruleCode.trimEnd().replace(/};\s*$/, "} satisfies RuleSet;\n");
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

  test("blocks symlink to file outside project", async () => {
    // Create a real file outside the project
    const outsideDir = mkdtempSync(join(tmpdir(), "archgate-outside-"));
    writeFileSync(join(outsideDir, "secret.txt"), "sensitive data");

    // Create a symlink inside the project pointing outside
    try {
      symlinkSync(
        join(outsideDir, "secret.txt"),
        join(tempDir, "src", "linked.txt")
      );
    } catch {
      // Symlink creation may fail on Windows without admin privileges — skip
      rmSync(outsideDir, { recursive: true, force: true });
      return;
    }

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

    rmSync(outsideDir, { recursive: true, force: true });
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
