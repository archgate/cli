// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";

import { registerDomainAddCommand } from "./add";
import { registerDomainListCommand } from "./list";
import { registerDomainRemoveCommand } from "./remove";

export function registerDomainCommand(program: Command) {
  const domain = program
    .command("domain")
    .description("Manage custom ADR domains (name → ID prefix mappings)");

  registerDomainListCommand(domain);
  registerDomainAddCommand(domain);
  registerDomainRemoveCommand(domain);
}
