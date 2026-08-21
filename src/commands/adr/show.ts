// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";

import { findAdrFileById } from "../../helpers/adr-writer";
import { handleCommandError } from "../../helpers/exit";
import { renderMarkdownForTerminal } from "../../helpers/markdown-terminal";
import { requireProjectRoot } from "../../helpers/paths";
import { resolvedProjectPaths } from "../../helpers/project-config";
import { UserError } from "../../helpers/user-error";

export function registerAdrShowCommand(adr: Command) {
  adr
    .command("show")
    .description("Show a specific ADR by ID")
    .argument("<id>", "ADR ID (e.g., GEN-001)")
    .action(async (id) => {
      try {
        const projectRoot = requireProjectRoot();
        const { adrsDir } = resolvedProjectPaths(projectRoot);
        const adr = await findAdrFileById(adrsDir, id);

        if (!adr) {
          throw new UserError(
            `ADR with ID '${id}' not found.`,
            "Run `archgate adr list` to see available ADRs."
          );
        }

        // Raw source unless a human is watching: piped output feeds agents and
        // scripts, which parse the file verbatim (ARCH-003). `write` rather
        // than `console.log`, which would append a second trailing newline to
        // a file that already ends in one.
        if (!process.stdout.isTTY) {
          process.stdout.write(await Bun.file(adr.filePath).text());
          return;
        }

        // `adr.body` excludes the YAML frontmatter, which markdown would
        // otherwise read as a horizontal rule followed by a setext heading.
        const fm = adr.frontmatter;
        console.log(styleText("bold", `${fm.id}  ${fm.title}`));
        console.log(
          styleText("dim", `${fm.domain}${fm.rules ? "  rules" : ""}`)
        );
        console.log(renderMarkdownForTerminal(adr.body));
      } catch (err) {
        await handleCommandError(err);
      }
    });
}
