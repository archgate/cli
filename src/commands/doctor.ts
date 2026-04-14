import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";

import type { DoctorReport } from "../helpers/doctor";
import { runDoctor } from "../helpers/doctor";
import { exitWith } from "../helpers/exit";
import { logError } from "../helpers/log";
import { formatJSON, isAgentContext } from "../helpers/output";

const CHECK = styleText("green", "OK");
const CROSS = styleText("red", "MISSING");
const WARN = styleText("yellow", "NO");

function bool(value: boolean, trueLabel = CHECK, falseLabel = CROSS): string {
  return value ? trueLabel : falseLabel;
}

function printConsole(report: DoctorReport): void {
  const { system, archgate, project, editors, integrations } = report;

  console.log(styleText("bold", "\nSystem"));
  console.log(`  OS:           ${system.os}/${system.arch}`);
  if (system.is_wsl) {
    console.log(`  WSL:          ${system.wsl_distro ?? "yes"}`);
  }
  console.log(`  Bun:          ${system.bun_version}`);
  console.log(`  Node:         ${system.node_version}`);

  console.log(styleText("bold", "\nArchgate"));
  console.log(`  Version:      ${archgate.version}`);
  console.log(`  Install:      ${archgate.install_method}`);
  console.log(`  Exec path:    ${archgate.exec_path}`);
  console.log(
    `  Config dir:   ${archgate.config_dir} ${bool(archgate.config_dir_exists)}`
  );
  console.log(
    `  Telemetry:    ${archgate.telemetry_enabled ? "enabled" : "disabled"}`
  );
  console.log(`  Logged in:    ${bool(archgate.logged_in, "yes", WARN)}`);

  console.log(styleText("bold", "\nProject"));
  if (project.has_project) {
    console.log(
      `  ADRs:         ${project.adr_count} (${project.adr_with_rules_count} with rules)`
    );
    console.log(
      `  Domains:      ${project.domains.length > 0 ? project.domains.join(", ") : "none"}`
    );
  } else {
    console.log(
      `  Status:       ${styleText("yellow", "no .archgate/ found in current directory")}`
    );
  }

  console.log(styleText("bold", "\nEditor CLIs"));
  console.log(`  claude:       ${bool(editors.claude_cli)}`);
  console.log(`  cursor:       ${bool(editors.cursor_cli)}`);
  console.log(`  code (vscode):${bool(editors.vscode_cli)}`);
  console.log(`  copilot:      ${bool(editors.copilot_cli)}`);
  console.log(`  git:          ${bool(editors.git)}`);

  console.log(styleText("bold", "\nProject Integrations"));
  if (project.has_project) {
    console.log(
      `  Claude:       ${bool(integrations.claude_plugin)} (.claude/settings.local.json)`
    );
    console.log(
      `  Cursor:       ${bool(integrations.cursor_plugin)} (.cursor/rules/archgate-governance.mdc)`
    );
    console.log(
      `  VS Code:      ${bool(integrations.vscode_settings)} (.vscode/settings.json)`
    );
    console.log(
      `  Copilot:      ${bool(integrations.copilot_settings)} (.github/copilot/instructions.md)`
    );
  } else {
    console.log(`  ${styleText("dim", "(no project — skipped)")}`);
  }

  console.log("");
}

export function registerDoctorCommand(program: Command) {
  program
    .command("doctor")
    .description("Check system environment and diagnose issues")
    .option("--json", "Output results as JSON")
    .action(async (opts) => {
      try {
        const report = await runDoctor();
        const useJson = opts.json || isAgentContext();

        if (useJson) {
          console.log(formatJSON(report, opts.json ? true : undefined));
        } else {
          printConsole(report);
        }
      } catch (err) {
        logError(err instanceof Error ? err.message : String(err));
        await exitWith(1);
      }
    });
}
