// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Test preload — sets environment for all test runs.
 *
 * Tests run with piped stdout (no TTY). Without CI=1, the auto-detect
 * in src/helpers/output.ts treats them as agent context and emits compact
 * JSON instead of human-readable output, breaking command assertions.
 */
Bun.env.CI = Bun.env.CI ?? "1";

/**
 * Suppress all git credential prompts during tests.
 * - GIT_TERMINAL_PROMPT=0 — prevents terminal-based prompts
 * - GCM_INTERACTIVE=never — prevents GUI prompts from Git Credential Manager
 * - GIT_ASKPASS="" — prevents external askpass programs from launching
 */
Bun.env.GIT_TERMINAL_PROMPT = "0";
Bun.env.GCM_INTERACTIVE = "never";
Bun.env.GIT_ASKPASS = "";
