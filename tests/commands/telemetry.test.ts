// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerTelemetryCommand } from "../../src/commands/telemetry";
import * as exitModule from "../../src/helpers/exit";
import * as logModule from "../../src/helpers/log";
import * as telemetryModule from "../../src/helpers/telemetry";
import * as telemetryConfigModule from "../../src/helpers/telemetry-config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProgram(): Command {
  const program = new Command().exitOverride();
  registerTelemetryCommand(program);
  return program;
}

function collectOutput(spy: ReturnType<typeof spyOn>): string {
  return spy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
}

// ---------------------------------------------------------------------------
// Tests — Command registration
// ---------------------------------------------------------------------------

describe("registerTelemetryCommand", () => {
  test("registers 'telemetry' as a subcommand", () => {
    const program = new Command();
    registerTelemetryCommand(program);
    const sub = program.commands.find((c) => c.name() === "telemetry");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const program = new Command();
    registerTelemetryCommand(program);
    const sub = program.commands.find((c) => c.name() === "telemetry")!;
    expect(sub.description()).toBeTruthy();
  });

  test("registers 'status' subcommand", () => {
    const program = new Command();
    registerTelemetryCommand(program);
    const telemetry = program.commands.find((c) => c.name() === "telemetry")!;
    const status = telemetry.commands.find((c) => c.name() === "status");
    expect(status).toBeDefined();
  });

  test("registers 'enable' subcommand", () => {
    const program = new Command();
    registerTelemetryCommand(program);
    const telemetry = program.commands.find((c) => c.name() === "telemetry")!;
    const enable = telemetry.commands.find((c) => c.name() === "enable");
    expect(enable).toBeDefined();
  });

  test("registers 'disable' subcommand", () => {
    const program = new Command();
    registerTelemetryCommand(program);
    const telemetry = program.commands.find((c) => c.name() === "telemetry")!;
    const disable = telemetry.commands.find((c) => c.name() === "disable");
    expect(disable).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests — telemetry status
// ---------------------------------------------------------------------------

describe("telemetry status", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let isTelemetryEnabledSpy: ReturnType<typeof spyOn>;
  let isEnvTelemetryDisabledSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    isTelemetryEnabledSpy = spyOn(telemetryConfigModule, "isTelemetryEnabled");
    isEnvTelemetryDisabledSpy = spyOn(
      telemetryConfigModule,
      "isEnvTelemetryDisabled"
    );
  });

  afterEach(() => {
    logSpy.mockRestore();
    isTelemetryEnabledSpy.mockRestore();
    isEnvTelemetryDisabledSpy.mockRestore();
  });

  test("prints enabled message when telemetry is enabled", async () => {
    isTelemetryEnabledSpy.mockReturnValue(true);
    isEnvTelemetryDisabledSpy.mockReturnValue(false);

    const program = makeProgram();
    await program.parseAsync(["node", "test", "telemetry", "status"]);

    const output = collectOutput(logSpy);
    expect(output).toContain("Telemetry is enabled.");
    expect(output).toContain("Anonymous usage data helps improve Archgate");
  });

  test("prints disabled message when telemetry is disabled", async () => {
    isTelemetryEnabledSpy.mockReturnValue(false);
    isEnvTelemetryDisabledSpy.mockReturnValue(false);

    const program = makeProgram();
    await program.parseAsync(["node", "test", "telemetry", "status"]);

    const output = collectOutput(logSpy);
    expect(output).toContain("Telemetry is disabled.");
    expect(output).toContain("To enable:");
  });

  test("prints env override message when ARCHGATE_TELEMETRY disables telemetry", async () => {
    isEnvTelemetryDisabledSpy.mockReturnValue(true);
    isTelemetryEnabledSpy.mockReturnValue(false);

    const program = makeProgram();
    await program.parseAsync(["node", "test", "telemetry", "status"]);

    const output = collectOutput(logSpy);
    expect(output).toContain("ARCHGATE_TELEMETRY environment variable");
  });
});

// ---------------------------------------------------------------------------
// Tests — telemetry enable
// ---------------------------------------------------------------------------

describe("telemetry enable", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let setTelemetryEnabledSpy: ReturnType<typeof spyOn>;
  let initTelemetrySpy: ReturnType<typeof spyOn>;
  let trackPreferenceChangeSpy: ReturnType<typeof spyOn>;
  let flushTelemetrySpy: ReturnType<typeof spyOn>;
  let isEnvTelemetryDisabledSpy: ReturnType<typeof spyOn>;
  let logErrorSpy: ReturnType<typeof spyOn>;
  let exitWithSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    setTelemetryEnabledSpy = spyOn(
      telemetryConfigModule,
      "setTelemetryEnabled"
    ).mockReturnValue(Promise.resolve());
    initTelemetrySpy = spyOn(telemetryModule, "initTelemetry").mockReturnValue(
      Promise.resolve()
    );
    trackPreferenceChangeSpy = spyOn(
      telemetryModule,
      "trackTelemetryPreferenceChange"
    ).mockImplementation(() => {});
    flushTelemetrySpy = spyOn(
      telemetryModule,
      "flushTelemetry"
    ).mockReturnValue(Promise.resolve());
    isEnvTelemetryDisabledSpy = spyOn(
      telemetryConfigModule,
      "isEnvTelemetryDisabled"
    ).mockReturnValue(false);
    logErrorSpy = spyOn(logModule, "logError").mockImplementation(() => {});
    exitWithSpy = spyOn(exitModule, "exitWith").mockImplementation(
      (): Promise<never> => {
        throw new Error("process.exit");
      }
    );
  });

  afterEach(() => {
    mock.restore();
  });

  test("calls setTelemetryEnabled(true) and prints success", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "test", "telemetry", "enable"]);

    expect(setTelemetryEnabledSpy).toHaveBeenCalledWith(true);
    expect(initTelemetrySpy).toHaveBeenCalled();
    expect(trackPreferenceChangeSpy).toHaveBeenCalledWith({ enabled: true });
    expect(flushTelemetrySpy).toHaveBeenCalled();

    const output = collectOutput(logSpy);
    expect(output).toContain("Telemetry enabled");
  });

  test("shows env override note when ARCHGATE_TELEMETRY is set", async () => {
    isEnvTelemetryDisabledSpy.mockReturnValue(true);

    const program = makeProgram();
    await program.parseAsync(["node", "test", "telemetry", "enable"]);

    const output = collectOutput(logSpy);
    expect(output).toContain("ARCHGATE_TELEMETRY environment variable");
    expect(output).toContain("Remove the environment variable");
    // Still calls setTelemetryEnabled
    expect(setTelemetryEnabledSpy).toHaveBeenCalledWith(true);
  });

  test("catches errors and calls logError + exitWith(1)", async () => {
    setTelemetryEnabledSpy.mockRejectedValue(new Error("disk full"));

    const program = makeProgram();
    await expect(
      program.parseAsync(["node", "test", "telemetry", "enable"])
    ).rejects.toThrow("process.exit");

    expect(logErrorSpy).toHaveBeenCalledWith("disk full");
    expect(exitWithSpy).toHaveBeenCalledWith(1);
  });

  test("re-throws ExitPromptError without catching", async () => {
    const exitPromptError = new Error("prompt cancelled");
    exitPromptError.name = "ExitPromptError";
    setTelemetryEnabledSpy.mockRejectedValue(exitPromptError);

    const program = makeProgram();
    await expect(
      program.parseAsync(["node", "test", "telemetry", "enable"])
    ).rejects.toThrow("prompt cancelled");

    // logError should NOT be called for ExitPromptError
    expect(logErrorSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — telemetry disable
// ---------------------------------------------------------------------------

describe("telemetry disable", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let setTelemetryEnabledSpy: ReturnType<typeof spyOn>;
  let trackPreferenceChangeSpy: ReturnType<typeof spyOn>;
  let flushTelemetrySpy: ReturnType<typeof spyOn>;
  let logErrorSpy: ReturnType<typeof spyOn>;
  let exitWithSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    setTelemetryEnabledSpy = spyOn(
      telemetryConfigModule,
      "setTelemetryEnabled"
    ).mockReturnValue(Promise.resolve());
    trackPreferenceChangeSpy = spyOn(
      telemetryModule,
      "trackTelemetryPreferenceChange"
    ).mockImplementation(() => {});
    flushTelemetrySpy = spyOn(
      telemetryModule,
      "flushTelemetry"
    ).mockReturnValue(Promise.resolve());
    logErrorSpy = spyOn(logModule, "logError").mockImplementation(() => {});
    exitWithSpy = spyOn(exitModule, "exitWith").mockImplementation(
      (): Promise<never> => {
        throw new Error("process.exit");
      }
    );
  });

  afterEach(() => {
    mock.restore();
  });

  test("calls setTelemetryEnabled(false) and prints success", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "test", "telemetry", "disable"]);

    expect(trackPreferenceChangeSpy).toHaveBeenCalledWith({ enabled: false });
    expect(flushTelemetrySpy).toHaveBeenCalled();
    expect(setTelemetryEnabledSpy).toHaveBeenCalledWith(false);

    const output = collectOutput(logSpy);
    expect(output).toContain("Telemetry disabled");
  });

  test("tracks opt-out event before disabling", async () => {
    const callOrder: string[] = [];
    trackPreferenceChangeSpy.mockImplementation(() => {
      callOrder.push("track");
    });
    flushTelemetrySpy.mockImplementation(() => {
      callOrder.push("flush");
      return Promise.resolve();
    });
    setTelemetryEnabledSpy.mockImplementation(() => {
      callOrder.push("disable");
      return Promise.resolve();
    });

    const program = makeProgram();
    await program.parseAsync(["node", "test", "telemetry", "disable"]);

    expect(callOrder).toEqual(["track", "flush", "disable"]);
  });

  test("catches errors and calls logError + exitWith(1)", async () => {
    setTelemetryEnabledSpy.mockRejectedValue(new Error("permission denied"));

    const program = makeProgram();
    await expect(
      program.parseAsync(["node", "test", "telemetry", "disable"])
    ).rejects.toThrow("process.exit");

    expect(logErrorSpy).toHaveBeenCalledWith("permission denied");
    expect(exitWithSpy).toHaveBeenCalledWith(1);
  });

  test("re-throws ExitPromptError without catching", async () => {
    const exitPromptError = new Error("prompt cancelled");
    exitPromptError.name = "ExitPromptError";
    setTelemetryEnabledSpy.mockRejectedValue(exitPromptError);

    const program = makeProgram();
    await expect(
      program.parseAsync(["node", "test", "telemetry", "disable"])
    ).rejects.toThrow("prompt cancelled");

    expect(logErrorSpy).not.toHaveBeenCalled();
  });
});
