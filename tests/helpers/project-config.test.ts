// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  addCustomDomain,
  getAllDomainNames,
  getMergedDomainPrefixes,
  isDefaultDomain,
  listDomainEntries,
  loadProjectConfig,
  removeCustomDomain,
  resolveDomainPrefix,
  saveProjectConfig,
} from "../../src/helpers/project-config";

describe("project-config", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "archgate-project-config-"));
    mkdirSync(join(projectRoot, ".archgate"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test("loadProjectConfig returns empty when file missing", () => {
    expect(loadProjectConfig(projectRoot)).toEqual({ domains: {} });
  });

  test("addCustomDomain persists to disk and merges with defaults", async () => {
    await addCustomDomain(projectRoot, "security", "SEC");
    const config = loadProjectConfig(projectRoot);
    expect(config.domains.security).toBe("SEC");
    expect(existsSync(join(projectRoot, ".archgate", "config.json"))).toBe(
      true
    );

    const merged = getMergedDomainPrefixes(projectRoot);
    expect(merged.security).toBe("SEC");
    expect(merged.backend).toBe("BE");
  });

  test("addCustomDomain rejects built-in domain names", async () => {
    await expect(
      addCustomDomain(projectRoot, "backend", "BE2")
    ).rejects.toThrow(/built-in/u);
  });

  test("addCustomDomain rejects invalid name format", async () => {
    await expect(
      addCustomDomain(projectRoot, "Bad Name", "BAD")
    ).rejects.toThrow(/kebab-case/u);
  });

  test("addCustomDomain rejects invalid prefix format", async () => {
    await expect(
      addCustomDomain(projectRoot, "infra", "lower")
    ).rejects.toThrow(/uppercase/u);
  });

  test("addCustomDomain rejects prefix already used by a default", async () => {
    await expect(
      addCustomDomain(projectRoot, "backend2", "BE")
    ).rejects.toThrow(/built-in domain/u);
  });

  test("addCustomDomain rejects prefix already used by another custom domain", async () => {
    await addCustomDomain(projectRoot, "security", "SEC");
    await expect(
      addCustomDomain(projectRoot, "secrets", "SEC")
    ).rejects.toThrow(/already used/u);
  });

  test("removeCustomDomain deletes the entry", async () => {
    await addCustomDomain(projectRoot, "security", "SEC");
    const { removed } = await removeCustomDomain(projectRoot, "security");
    expect(removed).toBe(true);
    expect(loadProjectConfig(projectRoot).domains.security).toBeUndefined();
  });

  test("removeCustomDomain returns false when not present", async () => {
    const { removed } = await removeCustomDomain(projectRoot, "security");
    expect(removed).toBe(false);
  });

  test("removeCustomDomain rejects built-in domains", async () => {
    await expect(removeCustomDomain(projectRoot, "backend")).rejects.toThrow(
      /built-in/u
    );
  });

  test("resolveDomainPrefix falls back to built-in prefixes", () => {
    expect(resolveDomainPrefix(projectRoot, "backend")).toBe("BE");
  });

  test("resolveDomainPrefix returns custom prefix when registered", async () => {
    await addCustomDomain(projectRoot, "security", "SEC");
    expect(resolveDomainPrefix(projectRoot, "security")).toBe("SEC");
  });

  test("resolveDomainPrefix throws on unknown domain with helpful hint", () => {
    expect(() => resolveDomainPrefix(projectRoot, "nope")).toThrow(
      /archgate domain add/u
    );
  });

  test("getAllDomainNames merges defaults with custom domains", async () => {
    await addCustomDomain(projectRoot, "security", "SEC");
    const names = getAllDomainNames(projectRoot);
    expect(names).toContain("backend");
    expect(names).toContain("security");
  });

  test("listDomainEntries tags built-in vs custom source", async () => {
    await addCustomDomain(projectRoot, "security", "SEC");
    const entries = listDomainEntries(projectRoot);
    const be = entries.find((e) => e.domain === "backend");
    const sec = entries.find((e) => e.domain === "security");
    expect(be?.source).toBe("default");
    expect(sec?.source).toBe("custom");
  });

  test("isDefaultDomain recognises built-ins", () => {
    expect(isDefaultDomain("backend")).toBe(true);
    expect(isDefaultDomain("security")).toBe(false);
  });

  test("saveProjectConfig + loadProjectConfig roundtrip", async () => {
    await saveProjectConfig(projectRoot, { domains: { infra: "INFRA" } });
    expect(loadProjectConfig(projectRoot).domains.infra).toBe("INFRA");
  });
});
