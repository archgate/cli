// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// ---------------------------------------------------------------------------
// Action handler tests for two edges of the check command: the zero-rule-ADR
// path (its non-console reporters and its advisory diagnostics), and the
// ARCH-026 --strict stderr explanation that precedes a strict-driven exit.
// ---------------------------------------------------------------------------

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
  type Mock,
} from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerCheckCommand } from "../../src/commands/check";
import * as adrSectionsModule from "../../src/engine/adr-sections";
import * as loaderModule from "../../src/engine/loader";
import type { ReportSummary } from "../../src/engine/reporter";
import * as reporterModule from "../../src/engine/reporter";
import type { CheckResult } from "../../src/engine/runner";
import * as runnerModule from "../../src/engine/runner";
import * as exitModule from "../../src/helpers/exit";
import * as logModule from "../../src/helpers/log";
import * as pathsModule from "../../src/helpers/paths";
import * as stackDetectModule from "../../src/helpers/stack-detect";
import * as telemetryModule from "../../src/helpers/telemetry";

const MOCK_CHECK_RESULT: CheckResult = { results: [], totalDurationMs: 5 };

const BASE_SUMMARY: ReportSummary = {
  pass: true,
  total: 0,
  passed: 0,
  failed: 0,
  warnings: 0,
  errors: 0,
  infos: 0,
  ruleErrors: 0,
  warningsExceeded: false,
  strictAdvisoryExceeded: false,
  truncated: false,
  suppressed: 0,
  suppressionWarnings: [],
  unparsedAdrs: [],
  briefingWarnings: [],
  results: [],
  durationMs: 5,
};

const BRIEFING_WARNING = {
  adrId: "LONG-001",
  file: ".archgate/adrs/LONG-001-verbose.md",
  section: "Decision",
  length: 4000,
  cap: 2000,
};

describe("check action handler — zero-rule and strict branches", () => {
  let logSpy: Mock<typeof console.log>;
  let errorSpy: Mock<typeof console.error>;
  let warnSpy: Mock<typeof logModule.logWarn>;
  let exitSpy: Mock<typeof exitModule.exitWith>;
  let findProjectRootSpy: Mock<typeof pathsModule.findProjectRoot>;
  let loadRuleAdrsSpy: Mock<typeof loaderModule.loadRuleAdrs>;
  let runChecksSpy: Mock<typeof runnerModule.runChecks>;
  let buildSummarySpy: Mock<typeof reporterModule.buildSummary>;
  let getExitCodeSpy: Mock<typeof reporterModule.getExitCode>;
  let reportConsoleSpy: Mock<typeof reporterModule.reportConsole>;
  let reportJSONSpy: Mock<typeof reporterModule.reportJSON>;
  let reportCISpy: Mock<typeof reporterModule.reportCI>;
  let reportSarifSpy: Mock<typeof reporterModule.reportSarif>;
  let diagnosticsSpy: Mock<typeof adrSectionsModule.collectBriefingDiagnostics>;
  let detectStackSpy: Mock<typeof stackDetectModule.detectStack>;
  let trackCheckResultSpy: Mock<typeof telemetryModule.trackCheckResult>;
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    warnSpy = spyOn(logModule, "logWarn").mockImplementation(() => {});
    exitSpy = spyOn(exitModule, "exitWith").mockImplementation(() => {
      throw new Error("process.exit");
    });

    findProjectRootSpy = spyOn(pathsModule, "findProjectRoot").mockReturnValue(
      "/fake/project"
    );
    loadRuleAdrsSpy = spyOn(loaderModule, "loadRuleAdrs").mockResolvedValue([]);
    runChecksSpy = spyOn(runnerModule, "runChecks").mockResolvedValue(
      MOCK_CHECK_RESULT
    );
    buildSummarySpy = spyOn(reporterModule, "buildSummary").mockReturnValue(
      BASE_SUMMARY
    );
    getExitCodeSpy = spyOn(reporterModule, "getExitCode").mockReturnValue(0);
    reportConsoleSpy = spyOn(
      reporterModule,
      "reportConsole"
    ).mockImplementation(() => {});
    reportJSONSpy = spyOn(reporterModule, "reportJSON").mockImplementation(
      () => {}
    );
    reportCISpy = spyOn(reporterModule, "reportCI").mockImplementation(
      () => {}
    );
    reportSarifSpy = spyOn(reporterModule, "reportSarif").mockImplementation(
      () => {}
    );
    diagnosticsSpy = spyOn(
      adrSectionsModule,
      "collectBriefingDiagnostics"
    ).mockResolvedValue({ briefingWarnings: [], unparsedAdrs: [] });
    detectStackSpy = spyOn(stackDetectModule, "detectStack").mockResolvedValue({
      languages: [],
      runtimes: [],
      frameworks: [],
    });
    trackCheckResultSpy = spyOn(
      telemetryModule,
      "trackCheckResult"
    ).mockImplementation(() => {});

    originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    exitSpy.mockRestore();
    findProjectRootSpy.mockRestore();
    loadRuleAdrsSpy.mockRestore();
    runChecksSpy.mockRestore();
    buildSummarySpy.mockRestore();
    getExitCodeSpy.mockRestore();
    reportConsoleSpy.mockRestore();
    reportJSONSpy.mockRestore();
    reportCISpy.mockRestore();
    reportSarifSpy.mockRestore();
    diagnosticsSpy.mockRestore();
    detectStackSpy.mockRestore();
    trackCheckResultSpy.mockRestore();
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
  });

  function makeProgram(): Command {
    const program = new Command().exitOverride();
    registerCheckCommand(program);
    return program;
  }

  function warnings(): string {
    return warnSpy.mock.calls.flat().map(String).join(" ");
  }

  // -- Zero rule ADRs: non-console reporters --

  test("no rules with --output sarif reports the empty result through reportSarif", async () => {
    expect(
      makeProgram().parseAsync(["node", "test", "check", "--output", "sarif"])
    ).rejects.toThrow("process.exit");

    expect(reportSarifSpy).toHaveBeenCalledTimes(1);
    expect(reportSarifSpy.mock.calls[0][0].results).toEqual([]);
    expect(reportCISpy).not.toHaveBeenCalled();
    expect(reportJSONSpy).not.toHaveBeenCalled();
    expect(reportConsoleSpy).not.toHaveBeenCalled();
  });

  test("no rules with --output github reports the empty result through reportCI", async () => {
    expect(
      makeProgram().parseAsync(["node", "test", "check", "--output", "github"])
    ).rejects.toThrow("process.exit");

    expect(reportCISpy).toHaveBeenCalledTimes(1);
    expect(reportCISpy.mock.calls[0][0].results).toEqual([]);
    expect(reportSarifSpy).not.toHaveBeenCalled();
    expect(reportConsoleSpy).not.toHaveBeenCalled();
  });

  // -- Zero rule ADRs: advisory diagnostics still surface on the console path --

  test("no rules still renders advisory findings on the console path", async () => {
    diagnosticsSpy.mockResolvedValue({
      briefingWarnings: [BRIEFING_WARNING],
      unparsedAdrs: [],
    });

    expect(makeProgram().parseAsync(["node", "test", "check"])).rejects.toThrow(
      "process.exit"
    );

    const output = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(output).toContain("No rules to check");
    // The corpus-wide diagnostics are rendered by the standard console
    // reporter, so a prose-only corpus still shows its briefing overruns.
    expect(reportConsoleSpy).toHaveBeenCalledTimes(1);
    expect(reportConsoleSpy.mock.calls[0][0].briefingWarnings).toEqual([
      BRIEFING_WARNING,
    ]);
  });

  test("no rules skips the console reporter when there is nothing advisory to show", async () => {
    expect(makeProgram().parseAsync(["node", "test", "check"])).rejects.toThrow(
      "process.exit"
    );

    expect(reportConsoleSpy).not.toHaveBeenCalled();
  });

  test("no rules with --strict explains an advisory-only failure", async () => {
    diagnosticsSpy.mockResolvedValue({
      briefingWarnings: [BRIEFING_WARNING],
      unparsedAdrs: ["broken.md"],
    });
    buildSummarySpy.mockReturnValue({
      ...BASE_SUMMARY,
      pass: false,
      strictAdvisoryExceeded: true,
    });
    getExitCodeSpy.mockReturnValue(1);

    expect(
      makeProgram().parseAsync(["node", "test", "check", "--strict"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(warnings()).toContain(
      "failing because advisory findings (briefing budget or unparsed ADRs) exist even though no rules ran"
    );
  });

  test("no rules without --strict stays silent about advisory findings", async () => {
    diagnosticsSpy.mockResolvedValue({
      briefingWarnings: [BRIEFING_WARNING],
      unparsedAdrs: [],
    });
    buildSummarySpy.mockReturnValue({
      ...BASE_SUMMARY,
      strictAdvisoryExceeded: true,
    });

    expect(makeProgram().parseAsync(["node", "test", "check"])).rejects.toThrow(
      "process.exit"
    );

    expect(warnSpy).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  // -- ARCH-026 strict explanation after a normal run --

  test("--strict explains a warning-driven failure", async () => {
    loadRuleAdrsSpy.mockResolvedValue([
      // Only the array length is read before runChecks is reached, which is
      // itself stubbed — the ADR/ruleSet contents are never touched.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      { type: "loaded", value: {} } as unknown as loaderModule.LoadResult,
    ]);
    buildSummarySpy.mockReturnValue({
      ...BASE_SUMMARY,
      pass: false,
      warnings: 3,
      warningsExceeded: true,
    });
    getExitCodeSpy.mockReturnValue(1);

    expect(
      makeProgram().parseAsync(["node", "test", "check", "--strict"])
    ).rejects.toThrow("process.exit");

    expect(warnings()).toContain(
      "3 rule-severity warning(s) are treated as failures under --strict"
    );
    expect(warnings()).not.toContain("advisory findings");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("--strict joins both reasons when warnings and advisory findings coexist", async () => {
    loadRuleAdrsSpy.mockResolvedValue([
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      { type: "loaded", value: {} } as unknown as loaderModule.LoadResult,
    ]);
    buildSummarySpy.mockReturnValue({
      ...BASE_SUMMARY,
      pass: false,
      warnings: 1,
      warningsExceeded: true,
      strictAdvisoryExceeded: true,
    });
    getExitCodeSpy.mockReturnValue(1);

    expect(
      makeProgram().parseAsync(["node", "test", "check", "--strict"])
    ).rejects.toThrow("process.exit");

    expect(warnings()).toContain(
      "1 rule-severity warning(s) are treated as failures under --strict; advisory findings (briefing budget, suppression, or unparsed ADRs) failed under --strict"
    );
  });

  test("--strict with nothing strict-relevant emits no explanation", async () => {
    loadRuleAdrsSpy.mockResolvedValue([
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      { type: "loaded", value: {} } as unknown as loaderModule.LoadResult,
    ]);

    expect(
      makeProgram().parseAsync(["node", "test", "check", "--strict"])
    ).rejects.toThrow("process.exit");

    expect(warnSpy).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
