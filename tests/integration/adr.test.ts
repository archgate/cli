import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { safeRmSync } from "../test-utils";
import {
  runCli,
  createTempProject,
  scaffoldProject,
  writeAdr,
  makeAdr,
} from "./cli-harness";

let tempDir: string;

beforeEach(() => {
  tempDir = createTempProject("archgate-adr-integ-");
});

afterEach(() => {
  safeRmSync(tempDir);
});

describe("adr integration", () => {
  // adr create

  describe("adr create", () => {
    test("creates ADR file", async () => {
      scaffoldProject(tempDir);
      const result = await runCli(
        [
          "adr",
          "create",
          "--title",
          "Test Decision",
          "--domain",
          "architecture",
        ],
        tempDir
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Created ADR");
      const files = readdirSync(join(tempDir, ".archgate", "adrs")).filter(
        (f) => f.endsWith(".md")
      );
      expect(files.length).toBeGreaterThan(0);
    });

    test("create with --json", async () => {
      scaffoldProject(tempDir);
      const result = await runCli(
        [
          "adr",
          "create",
          "--title",
          "Test Decision",
          "--domain",
          "architecture",
          "--json",
        ],
        tempDir
      );
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.id).toBeTruthy();
      expect(parsed.filePath).toBeTruthy();
    });

    test("create with --files", async () => {
      scaffoldProject(tempDir);
      const result = await runCli(
        [
          "adr",
          "create",
          "--title",
          "File Patterns",
          "--domain",
          "architecture",
          "--files",
          "src/**/*.ts,lib/**",
        ],
        tempDir
      );
      expect(result.exitCode).toBe(0);
      const adrsDir = join(tempDir, ".archgate", "adrs");
      const files = readdirSync(adrsDir).filter((f) => f.endsWith(".md"));
      expect(files.length).toBeGreaterThan(0);
      const content = await Bun.file(join(adrsDir, files[0])).text();
      expect(content).toContain("files:");
    });

    test("create with --body", async () => {
      scaffoldProject(tempDir);
      const result = await runCli(
        [
          "adr",
          "create",
          "--title",
          "Custom Body",
          "--domain",
          "general",
          "--body",
          "## Context\nCustom body",
        ],
        tempDir
      );
      expect(result.exitCode).toBe(0);
      const adrsDir = join(tempDir, ".archgate", "adrs");
      const files = readdirSync(adrsDir).filter((f) => f.endsWith(".md"));
      expect(files.length).toBeGreaterThan(0);
      const content = await Bun.file(join(adrsDir, files[0])).text();
      expect(content).toContain("Custom body");
    });

    test("create with --rules", async () => {
      scaffoldProject(tempDir);
      const result = await runCli(
        [
          "adr",
          "create",
          "--title",
          "With Rules",
          "--domain",
          "backend",
          "--rules",
          "--body",
          "## Context\nRule-enforced decision.",
        ],
        tempDir
      );
      expect(result.exitCode).toBe(0);
      const adrsDir = join(tempDir, ".archgate", "adrs");
      const mdFiles = readdirSync(adrsDir).filter((f) => f.endsWith(".md"));
      expect(mdFiles.length).toBeGreaterThan(0);
      const content = await Bun.file(join(adrsDir, mdFiles[0])).text();
      expect(content).toContain("rules: true");
    });

    test("fails without .archgate", async () => {
      const result = await runCli(
        ["adr", "create", "--title", "Test", "--domain", "general"],
        tempDir
      );
      expect(result.exitCode).not.toBe(0);
    });
  });

  // adr list

  describe("adr list", () => {
    test("lists ADRs", async () => {
      scaffoldProject(tempDir);
      writeAdr(
        tempDir,
        "ARCH-001-use-typescript.md",
        makeAdr({
          id: "ARCH-001",
          title: "Use TypeScript",
          domain: "architecture",
        })
      );
      writeAdr(
        tempDir,
        "GEN-001-conventions.md",
        makeAdr({ id: "GEN-001", title: "Conventions", domain: "general" })
      );
      const result = await runCli(["adr", "list"], tempDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("ARCH-001");
      expect(result.stdout).toContain("GEN-001");
    });

    test("list with --json", async () => {
      scaffoldProject(tempDir);
      writeAdr(
        tempDir,
        "ARCH-001-use-typescript.md",
        makeAdr({
          id: "ARCH-001",
          title: "Use TypeScript",
          domain: "architecture",
        })
      );
      writeAdr(
        tempDir,
        "GEN-001-conventions.md",
        makeAdr({ id: "GEN-001", title: "Conventions", domain: "general" })
      );
      const result = await runCli(["adr", "list", "--json"], tempDir);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(2);
      expect(parsed[0]).toHaveProperty("id");
      expect(parsed[0]).toHaveProperty("domain");
    });

    test("list with --domain filter", async () => {
      scaffoldProject(tempDir);
      writeAdr(
        tempDir,
        "ARCH-001-use-typescript.md",
        makeAdr({
          id: "ARCH-001",
          title: "Use TypeScript",
          domain: "architecture",
        })
      );
      writeAdr(
        tempDir,
        "GEN-001-conventions.md",
        makeAdr({ id: "GEN-001", title: "Conventions", domain: "general" })
      );
      const result = await runCli(
        ["adr", "list", "--domain", "architecture"],
        tempDir
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("ARCH-001");
      expect(result.stdout).not.toContain("GEN-001");
    });

    test("empty list", async () => {
      scaffoldProject(tempDir);
      const result = await runCli(["adr", "list"], tempDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No ADRs found");
    });

    test("fails without .archgate", async () => {
      const result = await runCli(["adr", "list"], tempDir);
      expect(result.exitCode).not.toBe(0);
    });
  });
});
