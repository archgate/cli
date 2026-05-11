// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerAdrImportCommand } from "../../../src/commands/adr/import";

describe("registerAdrImportCommand", () => {
  test("registers 'import' as a subcommand", () => {
    const parent = new Command("adr");
    registerAdrImportCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "import");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const parent = new Command("adr");
    registerAdrImportCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "import")!;
    expect(sub.description()).toBeTruthy();
  });

  test("accepts --yes option", () => {
    const parent = new Command("adr");
    registerAdrImportCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "import")!;
    const yesOpt = sub.options.find((o) => o.long === "--yes");
    expect(yesOpt).toBeDefined();
  });

  test("accepts --json option", () => {
    const parent = new Command("adr");
    registerAdrImportCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "import")!;
    const jsonOpt = sub.options.find((o) => o.long === "--json");
    expect(jsonOpt).toBeDefined();
  });

  test("accepts --dry-run option", () => {
    const parent = new Command("adr");
    registerAdrImportCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "import")!;
    const dryRunOpt = sub.options.find((o) => o.long === "--dry-run");
    expect(dryRunOpt).toBeDefined();
  });

  test("accepts --prefix option", () => {
    const parent = new Command("adr");
    registerAdrImportCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "import")!;
    const prefixOpt = sub.options.find((o) => o.long === "--prefix");
    expect(prefixOpt).toBeDefined();
  });

  test("accepts --list option", () => {
    const parent = new Command("adr");
    registerAdrImportCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "import")!;
    const listOpt = sub.options.find((o) => o.long === "--list");
    expect(listOpt).toBeDefined();
  });

  test("requires <source...> argument", () => {
    const parent = new Command("adr");
    registerAdrImportCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "import")!;
    // Commander stores registered arguments; the first should be source
    expect(sub.registeredArguments.length).toBeGreaterThanOrEqual(1);
    expect(sub.registeredArguments[0].name()).toBe("source");
  });
});
