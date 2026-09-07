---
name: credential-helper-fire-test
description: How to verify `archgate credential` end to end through git — the unit tests mock the stdin read, so only a real `git credential fill` proves the helper answers
metadata:
  type: project
---

Verify any change to `archgate credential` (or to how the CLI reads stdin) by running it as git's helper, not only through `bun run test`.

**Why:** `tests/commands/credential.test.ts` mocks the stdin read, so it cannot see the process exit before the read completes, and a helper that exits 0 with nothing on stdout is indistinguishable from "no stored credentials" — git just reports `could not read Username`. Claude Code's marketplace refresh surfaces that as `Failed to clone marketplace repository`.

**How to apply:**

- Direct probe (proves the read and the token lookup): `printf 'protocol=https\nhost=plugins.archgate.dev\n\n' | bun run src/cli.ts credential get` must print `username=`/`password=` lines.
- Through git (proves the pipe shape git uses): `printf '...' | GCM_INTERACTIVE=never git -c "credential.https://plugins.archgate.dev.helper=!bun run <abs path>/src/cli.ts credential" credential fill`, then `git -c ... ls-remote https://plugins.archgate.dev/archgate.git`.
- Never clear the global helper list in that probe (`-c credential.helper=`): git exports every `-c` to the helper via `GIT_CONFIG_PARAMETERS`, so the helper's own nested `git credential fill` for `auth.archgate.dev` loses Git Credential Manager and reports no stored session — a harness artifact that looks like a real failure.
- Always set `GCM_INTERACTIVE=never` on probes: Git Credential Manager runs first in the global chain and opens a GUI password dialog on the user's desktop when asked for the plugins host without it.
- The installed `~/.archgate/bin/archgate.exe` is what git actually runs for the user; a fix in `src/` reaches them only after a release and `archgate upgrade`.
