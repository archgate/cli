import type { Command } from "@commander-js/extra-typings";

import { exitWith } from "../helpers/exit";
import { logError } from "../helpers/log";
import {
  flushTelemetry,
  initTelemetry,
  trackTelemetryPreferenceChange,
} from "../helpers/telemetry";
import {
  isTelemetryEnabled,
  isEnvTelemetryDisabled,
  setTelemetryEnabled,
} from "../helpers/telemetry-config";

export function registerTelemetryCommand(program: Command) {
  const telemetry = program
    .command("telemetry")
    .description("Manage anonymous usage data collection");

  telemetry
    .command("status")
    .description("Show current telemetry status")
    .action(() => {
      const enabled = isTelemetryEnabled();
      const envOverride = isEnvTelemetryDisabled();

      if (envOverride) {
        console.log(
          "Telemetry is disabled (ARCHGATE_TELEMETRY environment variable)."
        );
      } else if (enabled) {
        console.log("Telemetry is enabled.");
        console.log(
          "Anonymous usage data helps improve Archgate. No personal information is collected."
        );
        console.log(
          "\nTo disable: `archgate telemetry disable` or set ARCHGATE_TELEMETRY=0"
        );
        console.log("Learn more: https://cli.archgate.dev/reference/telemetry");
      } else {
        console.log("Telemetry is disabled.");
        console.log("To enable: `archgate telemetry enable`");
      }
    });

  telemetry
    .command("enable")
    .description("Enable anonymous usage data collection")
    .action(async () => {
      try {
        if (isEnvTelemetryDisabled()) {
          console.log(
            "Note: ARCHGATE_TELEMETRY environment variable is set to disable telemetry."
          );
          console.log(
            "Remove the environment variable for this setting to take effect."
          );
        }
        await setTelemetryEnabled(true);
        // Initialize the client so we can emit the opt-in event. Fire and
        // forget — if flush fails for any reason it must not block the
        // command. Disabled via env var? Both calls are no-ops.
        await initTelemetry();
        trackTelemetryPreferenceChange({ enabled: true });
        await flushTelemetry();
        console.log(
          "Telemetry enabled. Thank you for helping improve Archgate."
        );
      } catch (err) {
        if (err instanceof Error && err.name === "ExitPromptError") throw err;
        logError(err instanceof Error ? err.message : String(err));
        await exitWith(1);
      }
    });

  telemetry
    .command("disable")
    .description("Disable anonymous usage data collection")
    .action(async () => {
      try {
        // Emit the opt-out event BEFORE persisting the disable — once the
        // config flips off, future trackEvent calls are no-ops. We also
        // flush before returning so the event actually ships.
        trackTelemetryPreferenceChange({ enabled: false });
        await flushTelemetry();
        await setTelemetryEnabled(false);
        console.log("Telemetry disabled. No usage data will be collected.");
      } catch (err) {
        if (err instanceof Error && err.name === "ExitPromptError") throw err;
        logError(err instanceof Error ? err.message : String(err));
        await exitWith(1);
      }
    });
}
