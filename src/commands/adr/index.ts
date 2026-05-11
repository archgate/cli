// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";

import { registerAdrCreateCommand } from "./create";
import { registerDomainCommand } from "./domain/index";
import { registerAdrImportCommand } from "./import";
import { registerAdrListCommand } from "./list";
import { registerAdrShowCommand } from "./show";
import { registerAdrSyncCommand } from "./sync";
import { registerAdrUpdateCommand } from "./update";

export function registerAdrCommand(program: Command) {
  const adr = program
    .command("adr")
    .description("Manage Architecture Decision Records");

  registerAdrCreateCommand(adr);
  registerAdrImportCommand(adr);
  registerAdrListCommand(adr);
  registerAdrShowCommand(adr);
  registerAdrSyncCommand(adr);
  registerAdrUpdateCommand(adr);
  registerDomainCommand(adr);
}
