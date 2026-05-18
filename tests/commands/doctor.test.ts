// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerDoctorCommand } from "../../src/commands/doctor";
import type { DoctorReport } from "../../src/helpers/doctor";
import * as doctorModule from "../../src/helpers/doctor";

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const MOCK_REPORT: DoctorReport = {
  system: {
    os: "linux",
    arch: "x64",
    is_wsl: false,
    wsl_distro: null,
    bun_version: "1.2.21",
    node_version: "v22.0.0",
  },
  archgate: {
    version: "0.36.0",
    install_method: "binary",
    exec_path: "/usr/local/bin/archgate",
    config_dir: "/home/test/.archgate",
    config_dir_exists: true,
    telemetry_enabled: false,
    logged_in: true,
  },
  project: {
    has_project: true,
    adr_count: 5,
    adr_with_rules_count: 3,
    domains: ["architecture", "ci"],
  },
  editors: {
    claude_cli: true,
    cursor_cli: false,
    vscode_cli: true,
    copilot_cli: false,
    git: true,
  },
  integrations: {
    claude_plugin: true,
    cursor_plugin: false,
    vscode_settings: true,
    copilot_settings: false,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("registerDoctorCommand", () => {
  test("registers 'doctor' as a subcommand", () => {
    const program = new Command();
    registerDoctorCommand(program);
    const sub = program.commands.find((c) => c.name() === "doctor");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const program = new Command();
    registerDoctorCommand(program);
    const sub = program.commands.find((c) => c.name() === "doctor")!;
    expect(sub.description()).toBeTruthy();
  });

  test("accepts --json option", () => {
    const program = new Command();
    registerDoctorCommand(program);
    const sub = program.commands.find((c) => c.name() === "doctor")!;
    const jsonOpt = sub.options.find((o) => o.long === "--json");
    expect(jsonOpt).toBeDefined();
  });
});

describe("doctor action handler", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;
  let doctorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    doctorSpy = spyOn(doctorModule, "runDoctor").mockResolvedValue(MOCK_REPORT);
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    doctorSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  function makeProgram(): Command {
    const program = new Command().exitOverride();
    registerDoctorCommand(program);
    return program;
  }

  test("--json outputs valid JSON matching DoctorReport shape", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "test", "doctor", "--json"]);

    expect(doctorSpy).toHaveBeenCalledTimes(1);

    const output = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    const parsed = JSON.parse(output) as DoctorReport;

    expect(parsed.system.os).toBe("linux");
    expect(parsed.system.bun_version).toBe("1.2.21");
    expect(parsed.archgate.version).toBe("0.36.0");
    expect(parsed.archgate.logged_in).toBe(true);
    expect(parsed.project.has_project).toBe(true);
    expect(parsed.project.adr_count).toBe(5);
    expect(parsed.project.domains).toEqual(["architecture", "ci"]);
    expect(parsed.editors.claude_cli).toBe(true);
    expect(parsed.integrations.claude_plugin).toBe(true);
  });

  test("--json output is pretty-printed with 2-space indent", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "test", "doctor", "--json"]);

    const output = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");

    // Pretty-printed JSON starts with "{\n  " — compact JSON has no newlines.
    expect(output).toContain("\n  ");
  });

  test("default output prints formatted text sections", async () => {
    // Ensure stdout.isTTY is truthy so isAgentContext() returns false
    const originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });

    try {
      const program = makeProgram();
      await program.parseAsync(["node", "test", "doctor"]);

      expect(doctorSpy).toHaveBeenCalledTimes(1);

      const output = logSpy.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .join("\n");

      // Section headers
      expect(output).toContain("System");
      expect(output).toContain("Archgate");
      expect(output).toContain("Project");
      expect(output).toContain("Editor CLIs");
      expect(output).toContain("Project Integrations");

      // System values from mock
      expect(output).toContain("linux/x64");
      expect(output).toContain("1.2.21");

      // Archgate values
      expect(output).toContain("0.36.0");
      expect(output).toContain("binary");
      expect(output).toContain("disabled");

      // Project values
      expect(output).toContain("5 (3 with rules)");
      expect(output).toContain("architecture, ci");
    } finally {
      Object.defineProperty(process.stdout, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });

  test("default output shows WSL distro when is_wsl is true", async () => {
    const wslReport: DoctorReport = {
      ...MOCK_REPORT,
      system: {
        ...MOCK_REPORT.system,
        is_wsl: true,
        wsl_distro: "Ubuntu-22.04",
      },
    };
    doctorSpy.mockResolvedValue(wslReport);

    const originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });

    try {
      const program = makeProgram();
      await program.parseAsync(["node", "test", "doctor"]);

      const output = logSpy.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .join("\n");
      expect(output).toContain("WSL:");
      expect(output).toContain("Ubuntu-22.04");
    } finally {
      Object.defineProperty(process.stdout, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });

  test("default output shows 'no .archgate/ found' when has_project is false", async () => {
    const noProjectReport: DoctorReport = {
      ...MOCK_REPORT,
      project: {
        has_project: false,
        adr_count: 0,
        adr_with_rules_count: 0,
        domains: [],
      },
    };
    doctorSpy.mockResolvedValue(noProjectReport);

    const originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });

    try {
      const program = makeProgram();
      await program.parseAsync(["node", "test", "doctor"]);

      const output = logSpy.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .join("\n");
      expect(output).toContain("no .archgate/ found");
      // Integration section should show skipped message
      expect(output).toContain("no project");
    } finally {
      Object.defineProperty(process.stdout, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });

  test("error path logs error message and exits with code 1", async () => {
    doctorSpy.mockRejectedValue(new Error("doctor failed"));

    const program = makeProgram();

    await expect(
      program.parseAsync(["node", "test", "doctor"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);

    const errorOutput = errorSpy.mock.calls
      .map((c: unknown[]) => c.map(String).join(" "))
      .join("\n");
    expect(errorOutput).toContain("doctor failed");
  });

  test("error path handles non-Error thrown values", async () => {
    doctorSpy.mockRejectedValue("string error value");

    const program = makeProgram();

    await expect(
      program.parseAsync(["node", "test", "doctor"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);

    const errorOutput = errorSpy.mock.calls
      .map((c: unknown[]) => c.map(String).join(" "))
      .join("\n");
    expect(errorOutput).toContain("string error value");
  });

  test("error path re-throws ExitPromptError", async () => {
    const exitPromptError = new Error("exit prompt");
    exitPromptError.name = "ExitPromptError";
    doctorSpy.mockRejectedValue(exitPromptError);

    const program = makeProgram();

    await expect(
      program.parseAsync(["node", "test", "doctor"])
    ).rejects.toThrow("exit prompt");
  });
});
