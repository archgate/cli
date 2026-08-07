// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  type Mock,
  spyOn,
  test,
} from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before imports that use them.
// ---------------------------------------------------------------------------

interface PromptQuestion {
  name: string;
  choices?: Array<{ name: string; value: string }>;
  validate?: (input: string) => boolean | string;
}

/** Answers returned by the next inquirer.prompt() call; set per test. */
let promptAnswers: Record<string, unknown> = {};

const mockInquirerPrompt = mock(
  async (_questions: PromptQuestion[]): Promise<Record<string, unknown>> =>
    promptAnswers
);

void mock.module("inquirer", () => ({
  default: { prompt: mockInquirerPrompt },
}));

// ---------------------------------------------------------------------------
// Imports under test — loaded AFTER mocks are registered.
// ---------------------------------------------------------------------------

import { registerAdrCreateCommand } from "../../../src/commands/adr/create";
import { withPromptFix } from "../../../src/helpers/prompt";

describe("adr create interactive prompts", () => {
  let tempDir: string;
  let adrsDir: string;
  let originalCwd: string;
  let logSpy: Mock<typeof console.log>;

  // withPromptFix permanently rebinds console.log on Windows the first time it
  // runs (ARCH-019). Warming it up before any spy is installed keeps the
  // console.log spy below stable and its restore faithful.
  beforeAll(async () => {
    await withPromptFix(async () => true);
  });

  beforeEach(() => {
    promptAnswers = {};
    mockInquirerPrompt.mockClear();
    tempDir = mkdtempSync(join(tmpdir(), "archgate-create-interactive-"));
    adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    originalCwd = process.cwd();
    Bun.env.ARCHGATE_PROJECT_CEILING = tempDir;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    delete Bun.env.ARCHGATE_PROJECT_CEILING;
    rmSync(tempDir, { recursive: true, force: true });
    mock.restore();
  });

  function makeProgram(): Command {
    const parent = new Command("adr").exitOverride();
    registerAdrCreateCommand(parent);
    return parent;
  }

  function allOutput(): string {
    return logSpy.mock.calls.map((c) => String(c[0])).join("\n");
  }

  test("creates an ADR from prompted domain, title, and file patterns", async () => {
    promptAnswers = {
      domain: "backend",
      title: "Prompted ADR",
      files: "src/**/*.ts, tests/**/*.ts",
    };

    await makeProgram().parseAsync(["node", "adr", "create"]);

    expect(mockInquirerPrompt).toHaveBeenCalledTimes(1);
    const created = join(adrsDir, "BE-001-prompted-adr.md");
    expect(existsSync(created)).toBe(true);
    const content = await Bun.file(created).text();
    expect(content).toContain("src/**/*.ts");
    expect(content).toContain("tests/**/*.ts");
    expect(allOutput()).toContain("Created ADR:");
  });

  test("omits file patterns when the files prompt is answered empty", async () => {
    promptAnswers = { domain: "general", title: "No Patterns", files: "" };

    await makeProgram().parseAsync(["node", "adr", "create"]);

    const created = join(adrsDir, "GEN-001-no-patterns.md");
    expect(existsSync(created)).toBe(true);
    const content = await Bun.file(created).text();
    expect(content).not.toContain("files:");
  });

  test.each([
    ["--title", "Partial Flag"],
    ["--domain", "backend"],
  ])("prompts when only %s is supplied", async (flag, value) => {
    promptAnswers = { domain: "architecture", title: "From Prompt", files: "" };

    await makeProgram().parseAsync(["node", "adr", "create", flag, value]);

    expect(mockInquirerPrompt).toHaveBeenCalledTimes(1);
    expect(existsSync(join(adrsDir, "ARCH-001-from-prompt.md"))).toBe(true);
  });

  test("asks for domain, title, and files in that order", async () => {
    promptAnswers = {
      domain: "architecture",
      title: "Question Shape",
      files: "",
    };

    await makeProgram().parseAsync(["node", "adr", "create"]);

    const questions = mockInquirerPrompt.mock.calls[0][0];
    expect(questions.map((q) => q.name)).toEqual(["domain", "title", "files"]);
  });

  test("offers every known domain as a choice", async () => {
    promptAnswers = {
      domain: "architecture",
      title: "Domain Choices",
      files: "",
    };

    await makeProgram().parseAsync(["node", "adr", "create"]);

    const choices = mockInquirerPrompt.mock.calls[0][0][0].choices ?? [];
    expect(choices.map((c) => c.value)).toContain("architecture");
    expect(choices.map((c) => c.value)).toContain("backend");
    expect(choices.map((c) => c.name)).toContain("general");
  });

  test("rejects a blank title through the prompt validator", async () => {
    promptAnswers = { domain: "architecture", title: "Validator", files: "" };

    await makeProgram().parseAsync(["node", "adr", "create"]);

    const validate = mockInquirerPrompt.mock.calls[0][0][1].validate;
    expect(validate).toBeDefined();
    expect(validate?.("   ")).toBe("Title is required");
    expect(validate?.("Real Title")).toBe(true);
  });
});
