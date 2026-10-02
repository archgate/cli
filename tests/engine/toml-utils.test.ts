// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadRuleAdrs, type LoadResult } from "../../src/engine/loader";
import { runChecks } from "../../src/engine/runner";
import type { RuleSet } from "../../src/formats/rules";
import { safeRmSync } from "../test-utils";

describe("runChecks ctx.readTOML()", () => {
  let tempDir: string;
  let outsideDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-runner-toml-"));
    outsideDir = mkdtempSync(join(tmpdir(), "archgate-toml-outside-"));
  });

  afterEach(() => {
    safeRmSync(tempDir);
    safeRmSync(outsideDir);
  });

  function makeLoadedAdr(ruleSet: RuleSet): LoadResult {
    return {
      type: "loaded",
      value: {
        adr: {
          frontmatter: {
            id: "TOML-001",
            title: "TOML Test",
            domain: "general",
            rules: true,
          },
          body: "",
          filePath: join(tempDir, ".archgate", "adrs", "TOML-001.md"),
        },
        ruleSet,
      },
    };
  }

  test.each([
    {
      path: "pyproject.toml",
      text: '[project]\ndependencies = ["requests==2.32.0", "pydantic==2.9.0"]\n\n[dependency-groups]\nworker = ["requests==2.32.0"] # matching pin\n',
      expected: {
        project: { dependencies: ["requests==2.32.0", "pydantic==2.9.0"] },
        "dependency-groups": { worker: ["requests==2.32.0"] },
      },
    },
    {
      path: "Cargo.toml",
      text: '[package]\nname = "demo"\n[dependencies.serde]\nversion = "1"\nfeatures = [\n  "derive", # comment\n]\n',
      expected: {
        package: { name: "demo" },
        dependencies: { serde: { version: "1", features: ["derive"] } },
      },
    },
    {
      path: ".prototools",
      text: 'bun = "1.4.2"\n[settings]\nauto-install = true\n',
      expected: { bun: "1.4.2", settings: { "auto-install": true } },
    },
    {
      path: "config/data.toml",
      text: '"quoted.key" = "# literal"\ntool.ruff.line-length = 88\n[[targets]]\nname = "first"\n[[targets]]\nname = "second"\n',
      expected: {
        "quoted.key": "# literal",
        tool: { ruff: { "line-length": 88 } },
        targets: [{ name: "first" }, { name: "second" }],
      },
    },
    { path: "empty.toml", text: "# Only a comment\n", expected: {} },
  ])("parses $path", async ({ path, text, expected }) => {
    await Bun.write(join(tempDir, path), text);
    let parsed: unknown;
    const loaded = makeLoadedAdr({
      rules: {
        read: {
          description: "Read TOML config",
          async check(ctx) {
            parsed = await ctx.readTOML(path);
          },
        },
      },
    });

    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].error).toBeUndefined();
    expect(parsed).toEqual(expected);
  });

  test.each(['key = ["unclosed"\n', 'key = "first"\nkey = "second"\n'])(
    "invalid TOML surfaces a rule execution error: %s",
    async (text) => {
      await Bun.write(join(tempDir, "invalid.toml"), text);
      const loaded = makeLoadedAdr({
        rules: {
          read: {
            description: "Read invalid TOML",
            async check(ctx) {
              await ctx.readTOML("invalid.toml");
            },
          },
        },
      });

      const result = await runChecks(tempDir, [loaded]);
      expect(result.results[0].error).toMatch(
        /Failed to parse "invalid\.toml" as TOML: .+/u
      );
      expect(result.results[0].violations).toEqual([]);
    }
  );

  test("missing files surface a rule execution error", async () => {
    const loaded = makeLoadedAdr({
      rules: {
        read: {
          description: "Read missing TOML",
          async check(ctx) {
            await ctx.readTOML("missing.toml");
          },
        },
      },
    });
    const result = await runChecks(tempDir, [loaded]);
    expect(result.results[0].error).toContain("ENOENT");
  });

  test.each(["traversal", "absolute", "symlink"] as const)(
    "blocks %s paths outside the project",
    async (kind) => {
      await Bun.write(join(outsideDir, "secret.toml"), 'secret = "private"\n');
      const paths = {
        traversal: "../outside.toml",
        absolute: join(outsideDir, "secret.toml"),
        symlink: "linked/secret.toml",
      };
      if (kind === "symlink") {
        symlinkSync(outsideDir, join(tempDir, "linked"), "junction");
      }
      const loaded = makeLoadedAdr({
        rules: {
          read: {
            description: "Attempt to read outside the project",
            async check(ctx) {
              await ctx.readTOML(paths[kind]);
            },
          },
        },
      });
      const result = await runChecks(tempDir, [loaded]);
      expect(result.results[0].error).toContain("access denied");
    }
  );

  test("parsed mutations do not leak across calls or rules", async () => {
    await Bun.write(
      join(tempDir, "config.toml"),
      '[project]\nitems = ["original"]\n'
    );
    const observed: unknown[] = [];
    const rule = {
      description: "Mutate a parsed object",
      async check(ctx) {
        const first = await ctx.readTOML("config.toml");
        if (
          typeof first !== "object" ||
          first === null ||
          !("project" in first)
        ) {
          throw new Error("unexpected TOML shape");
        }
        const project = first.project;
        if (
          typeof project !== "object" ||
          project === null ||
          !("items" in project) ||
          !Array.isArray(project.items) ||
          !project.items.every(
            (item): item is string => typeof item === "string"
          )
        ) {
          throw new Error("unexpected TOML shape");
        }
        const items = project.items;
        observed.push([...items]);
        items.push("changed");
        observed.push(await ctx.readTOML("config.toml"));
      },
    } satisfies RuleSet["rules"][string];
    const result = await runChecks(tempDir, [
      makeLoadedAdr({ rules: { first: rule, second: rule } }),
    ]);
    expect(result.results.map((entry) => entry.error)).toEqual([
      undefined,
      undefined,
    ]);
    expect(observed).toEqual([
      ["original"],
      { project: { items: ["original"] } },
      ["original"],
      { project: { items: ["original"] } },
    ]);
  });

  test("on-disk sandboxed rules can inspect TOML and report violations", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    await Bun.write(
      join(tempDir, "pyproject.toml"),
      '[project]\nname = "demo"\n'
    );
    await Bun.write(
      join(adrsDir, "TOML-001.md"),
      "---\nid: TOML-001\ntitle: TOML Test\ndomain: general\nrules: true\n---\n"
    );
    await Bun.write(
      join(adrsDir, "TOML-001.rules.ts"),
      `/// <reference path="../rules.d.ts" />
export default {
  rules: {
    "project-name": {
      description: "Require the approved project name",
      async check(ctx) {
        const doc = await ctx.readTOML("pyproject.toml") as {
          project: { name: string };
        };
        if (doc.project.name !== "approved") {
          ctx.report.violation({
            message: "Unapproved project name: " + doc.project.name,
            file: "pyproject.toml",
          });
        }
      },
    },
  },
} satisfies RuleSet;
`
    );
    const loaded = await loadRuleAdrs(tempDir);
    const result = await runChecks(tempDir, loaded);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].error).toBeUndefined();
    expect(result.results[0].violations).toEqual([
      {
        message: "Unapproved project name: demo",
        file: "pyproject.toml",
        adrId: "TOML-001",
        ruleId: "project-name",
        severity: "error",
      },
    ]);
  });
});
