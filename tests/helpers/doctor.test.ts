// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { runDoctor } from "../../src/helpers/doctor";
import type { DoctorReport } from "../../src/helpers/doctor";

describe("doctor", () => {
  describe("runDoctor", () => {
    test("returns a complete DoctorReport structure", async () => {
      const report = await runDoctor();

      // System section
      expect(report.system).toBeDefined();
      expect(typeof report.system.os).toBe("string");
      expect(typeof report.system.arch).toBe("string");
      expect(typeof report.system.is_wsl).toBe("boolean");
      expect(typeof report.system.bun_version).toBe("string");
      expect(typeof report.system.node_version).toBe("string");

      // Archgate section
      expect(report.archgate).toBeDefined();
      expect(typeof report.archgate.version).toBe("string");
      expect(["binary", "proto", "local", "global-pm"]).toContain(
        report.archgate.install_method
      );
      expect(typeof report.archgate.exec_path).toBe("string");
      expect(typeof report.archgate.telemetry_enabled).toBe("boolean");
      expect(typeof report.archgate.logged_in).toBe("boolean");

      // Project section
      expect(report.project).toBeDefined();
      expect(typeof report.project.has_project).toBe("boolean");
      expect(typeof report.project.adr_count).toBe("number");
      expect(Array.isArray(report.project.domains)).toBe(true);

      // Editors section
      expect(report.editors).toBeDefined();
      expect(typeof report.editors.git).toBe("boolean");

      // Integrations section
      expect(report.integrations).toBeDefined();
    });

    test("detects the current project when run from repo root", async () => {
      // This test runs from the archgate CLI repo, which has .archgate/adrs/
      const report = await runDoctor();

      expect(report.project.has_project).toBe(true);
      expect(report.project.adr_count).toBeGreaterThan(0);
      expect(report.project.adr_with_rules_count).toBeGreaterThan(0);
      expect(report.project.domains.length).toBeGreaterThan(0);
    });

    test("report is JSON-serializable", async () => {
      const report = await runDoctor();
      const json = JSON.stringify(report);
      const parsed = JSON.parse(json) as DoctorReport;
      expect(parsed.system.os).toBe(report.system.os);
      expect(parsed.archgate.version).toBe(report.archgate.version);
    });
  });
});
