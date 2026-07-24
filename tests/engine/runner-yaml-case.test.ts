// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LoadResult } from "../../src/engine/loader";
import { runChecks } from "../../src/engine/runner";
import type { RuleSet } from "../../src/formats/rules";

describe("runChecks ctx.readYAML() / ctx.checkCase()", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-runner-yaml-"));
    mkdirSync(join(tempDir, "docs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeLoadedAdr(ruleSet: RuleSet): LoadResult {
    return {
      type: "loaded",
      value: {
        adr: {
          frontmatter: {
            id: "YAML-001",
            title: "readYAML/checkCase Test",
            domain: "general",
            rules: true,
          },
          body: "",
          filePath: "/test.md",
        },
        ruleSet,
      },
    };
  }

  test("readYAML parses a whole YAML file with frontmatter null", async () => {
    await Bun.write(
      join(tempDir, "config.yml"),
      "name: sample\nitems:\n  - one\n  - two\n"
    );

    let parsed: unknown;
    const loaded = makeLoadedAdr({
      rules: {
        "read-yaml": {
          description: "Read a YAML config",
          async check(ctx) {
            parsed = await ctx.readYAML("config.yml");
          },
        },
      },
    });

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].error).toBeUndefined();
    expect(parsed).toEqual({
      frontmatter: null,
      content: { name: "sample", items: ["one", "two"] },
    });
  });

  test("readYAML parses Markdown frontmatter and reports absence as null", async () => {
    await Bun.write(
      join(tempDir, "docs", "guide.md"),
      "---\ntitle: Guide\ntags: [a, b]\n---\n\n# Guide\n"
    );
    await Bun.write(join(tempDir, "docs", "plain.md"), "# No frontmatter\n");

    // `unknown`, not `ReadYamlResult | undefined`: TS narrows an
    // uninitialized closure variable at the assertions below.
    let withFm: unknown;
    let withoutFm: unknown;

    const loaded = makeLoadedAdr({
      rules: {
        "read-frontmatter": {
          description: "Read frontmatter",
          async check(ctx) {
            withFm = await ctx.readYAML("docs/guide.md");
            withoutFm = await ctx.readYAML("docs/plain.md");
          },
        },
      },
    });

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].error).toBeUndefined();
    expect(withFm).toEqual({
      frontmatter: { title: "Guide", tags: ["a", "b"] },
      content: "# Guide",
    });
    expect(withoutFm).toEqual({
      frontmatter: null,
      content: "# No frontmatter",
    });
  });

  test("readYAML rejects invalid YAML as a rule execution error (fail-closed)", async () => {
    await Bun.write(join(tempDir, "bad.yml"), "key: [unclosed\n");

    const loaded = makeLoadedAdr({
      rules: {
        "read-bad-yaml": {
          description: "Read invalid YAML",
          async check(ctx) {
            await ctx.readYAML("bad.yml");
          },
        },
      },
    });

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].error).toMatch(
      /Failed to parse "bad\.yml" as YAML/u
    );
  });

  test("readYAML enforces the project-root sandbox like readFile", async () => {
    const loaded = makeLoadedAdr({
      rules: {
        "escape-attempt": {
          description: "Attempt to read outside the project root",
          async check(ctx) {
            await ctx.readYAML("../outside.yml");
          },
        },
      },
    });

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].error).toMatch(/escapes project root/u);
  });

  test("checkCase is exposed on ctx and validates casing schemes", async () => {
    await Bun.write(join(tempDir, "docs", "Bad_Name.md"), "# x\n");
    await Bun.write(join(tempDir, "docs", "good-name.md"), "# x\n");

    const loaded = makeLoadedAdr({
      rules: {
        "kebab-filenames": {
          description: "Markdown filenames must be kebab-case",
          async check(ctx) {
            const files = await ctx.glob("docs/*.md");
            for (const file of files) {
              const stem = file.split("/").pop()?.replace(/\.md$/u, "") ?? "";
              if (ctx.checkCase(stem, "kebab-case")) continue;
              ctx.report.violation({
                message: `${file} is not kebab-case`,
                file,
              });
            }
          },
        },
      },
    });

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].error).toBeUndefined();
    expect(result.results[0].violations).toHaveLength(1);
    expect(result.results[0].violations[0].file).toBe("docs/Bad_Name.md");
  });
});
