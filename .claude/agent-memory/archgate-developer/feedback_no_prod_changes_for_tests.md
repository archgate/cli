---
name: no-prod-changes-for-tests
description: Never change production code semantics (e.g., env-first home resolution) just to make tests isolatable — mock the implementation in tests instead
metadata:
  type: feedback
---

Do not modify production code behavior solely to enable test isolation. Mock the function implementation in the tests instead.

**Why:** When fixing the flaky vscode-settings test failures (Bun caches `os.homedir()` on Linux, defeating per-test `HOME` overrides), I changed `getVscodeUserSettingsPath()` to resolve home from `Bun.env.HOME` at call time. The user rejected this: "overriding the caching mechanism only for testing is wrong. the user will never change their home dir." Real users never change HOME mid-process, so the env-first indirection added complexity that only tests needed.

**How to apply:** When a test needs to redirect user-scope paths (home dir, APPDATA, etc.), use `import * as os from "node:os"` + `spyOn(os, "homedir").mockReturnValue(tempDir)` — verified that Bun's spyOn on a builtin module namespace intercepts named imports in other modules (same live-binding mechanism as the first-party spyOn pattern in ARCH-005). Restore with `mockRestore()` in `afterEach`. Env-var overrides only work for code that reads `Bun.env.*` directly at call time (e.g., the APPDATA branch); they do NOT reach `os.homedir()` on Linux.
