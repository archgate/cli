import type { Command } from "@commander-js/extra-typings";

import { registerAdrCreateCommand } from "./create";
import { registerDomainCommand } from "./domain/index";
import { registerAdrListCommand } from "./list";
import { registerAdrShowCommand } from "./show";
import { registerAdrUpdateCommand } from "./update";

export function registerAdrCommand(program: Command) {
  const adr = program
    .command("adr")
    .description("Manage Architecture Decision Records");

  registerAdrCreateCommand(adr);
  registerAdrListCommand(adr);
  registerAdrShowCommand(adr);
  registerAdrUpdateCommand(adr);
  registerDomainCommand(adr);
}
