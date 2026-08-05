// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  addCustomDomain,
  ensureBaseBranch,
  getAllDomainNames,
  getConfiguredStrict,
  getMergedDomainPrefixes,
  isDefaultDomain,
  listDomainEntries,
  loadProjectConfig,
  removeCustomDomain,
  resolveDomainPrefix,
  resolvedProjectPaths,
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
    expect(addCustomDomain(projectRoot, "backend", "BE2")).rejects.toThrow(
      /built-in/u
    );
  });

  test("addCustomDomain rejects invalid name format", async () => {
    expect(addCustomDomain(projectRoot, "Bad Name", "BAD")).rejects.toThrow(
      /kebab-case/u
    );
  });

  test("addCustomDomain rejects invalid prefix format", async () => {
    expect(addCustomDomain(projectRoot, "infra", "lower")).rejects.toThrow(
      /uppercase/u
    );
  });

  test("addCustomDomain rejects prefix already used by a default", async () => {
    expect(addCustomDomain(projectRoot, "backend2", "BE")).rejects.toThrow(
      /built-in domain/u
    );
  });

  test("addCustomDomain rejects prefix already used by another custom domain", async () => {
    await addCustomDomain(projectRoot, "security", "SEC");
    expect(addCustomDomain(projectRoot, "secrets", "SEC")).rejects.toThrow(
      /already used/u
    );
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
    expect(removeCustomDomain(projectRoot, "backend")).rejects.toThrow(
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

  test("loadProjectConfig returns empty when valid JSON fails the schema", async () => {
    // Parses fine, so the JSON.parse guard never fires — the schema check is
    // the only thing standing between a hand-edited config and a bad shape.
    await Bun.write(
      join(projectRoot, ".archgate", "config.json"),
      JSON.stringify({ domains: { infra: 42 } })
    );
    expect(loadProjectConfig(projectRoot)).toEqual({ domains: {} });
  });

  describe("ensureBaseBranch", () => {
    test("returns the configured branch without invoking the detector", async () => {
      await saveProjectConfig(projectRoot, {
        domains: {},
        baseBranch: "develop",
      });
      let detectorCalls = 0;
      const detect = async (): Promise<string | null> => {
        detectorCalls++;
        return "main";
      };

      expect(await ensureBaseBranch(projectRoot, detect)).toBe("develop");
      expect(detectorCalls).toBe(0);
    });

    test("persists the detected branch when unconfigured", async () => {
      const result = await ensureBaseBranch(projectRoot, async () => "trunk");

      expect(result).toBe("trunk");
      expect(loadProjectConfig(projectRoot).baseBranch).toBe("trunk");
    });

    test("saves nothing when detection yields no branch", async () => {
      const result = await ensureBaseBranch(projectRoot, async () => null);

      expect(result).toBeNull();
      expect(existsSync(join(projectRoot, ".archgate", "config.json"))).toBe(
        false
      );
    });

    test("returns null when the detector throws (not a git repo)", async () => {
      const result = await ensureBaseBranch(projectRoot, async () => {
        throw new Error("not a git repository");
      });

      expect(result).toBeNull();
      expect(existsSync(join(projectRoot, ".archgate", "config.json"))).toBe(
        false
      );
    });
  });

  describe("getConfiguredStrict", () => {
    test("returns null when config file is absent", () => {
      expect(getConfiguredStrict(projectRoot)).toBeNull();
    });

    test("returns null when strict key is absent from an otherwise-valid config", async () => {
      await saveProjectConfig(projectRoot, { domains: { infra: "INFRA" } });
      expect(getConfiguredStrict(projectRoot)).toBeNull();
    });

    test("returns true when explicitly configured true", async () => {
      await saveProjectConfig(projectRoot, { domains: {}, strict: true });
      expect(getConfiguredStrict(projectRoot)).toBe(true);
    });

    test("returns false when explicitly configured false", async () => {
      await saveProjectConfig(projectRoot, { domains: {}, strict: false });
      expect(getConfiguredStrict(projectRoot)).toBe(false);
    });
  });

  describe("resolvedProjectPaths", () => {
    test("returns defaults when no paths config is set", () => {
      const paths = resolvedProjectPaths(projectRoot);
      expect(paths.adrsDir).toBe(join(projectRoot, ".archgate", "adrs"));
      expect(paths.lintDir).toBe(join(projectRoot, ".archgate", "lint"));
    });

    test("overrides adrsDir when paths.adrs is configured", async () => {
      await saveProjectConfig(projectRoot, {
        domains: {},
        paths: { adrs: "docs/adrs" },
      });
      const paths = resolvedProjectPaths(projectRoot);
      expect(paths.adrsDir).toBe(join(projectRoot, "docs", "adrs"));
      // lintDir stays default when paths.rules is not set
      expect(paths.lintDir).toBe(join(projectRoot, ".archgate", "lint"));
    });

    test("overrides lintDir when paths.rules is configured", async () => {
      await saveProjectConfig(projectRoot, {
        domains: {},
        paths: { rules: "docs/rules" },
      });
      const paths = resolvedProjectPaths(projectRoot);
      // adrsDir stays default when paths.adrs is not set
      expect(paths.adrsDir).toBe(join(projectRoot, ".archgate", "adrs"));
      expect(paths.lintDir).toBe(join(projectRoot, "docs", "rules"));
    });

    test("overrides both when paths.adrs and paths.rules are configured", async () => {
      await saveProjectConfig(projectRoot, {
        domains: {},
        paths: { adrs: "docs/adrs", rules: "docs/rules" },
      });
      const paths = resolvedProjectPaths(projectRoot);
      expect(paths.adrsDir).toBe(join(projectRoot, "docs", "adrs"));
      expect(paths.lintDir).toBe(join(projectRoot, "docs", "rules"));
    });

    test("root always points to .archgate/ regardless of paths config", async () => {
      await saveProjectConfig(projectRoot, {
        domains: {},
        paths: { adrs: "custom/adrs" },
      });
      const paths = resolvedProjectPaths(projectRoot);
      expect(paths.root).toBe(join(projectRoot, ".archgate"));
    });

    test("ignores invalid config and falls back to defaults", async () => {
      const configPath = join(projectRoot, ".archgate", "config.json");
      await Bun.write(configPath, "not valid json");
      const paths = resolvedProjectPaths(projectRoot);
      expect(paths.adrsDir).toBe(join(projectRoot, ".archgate", "adrs"));
    });
  });
});
