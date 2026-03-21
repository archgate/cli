/**
 * Test preload — sets environment for all test runs.
 *
 * Tests run with piped stdout (no TTY). Without CI=1, the auto-detect
 * in src/helpers/output.ts treats them as agent context and emits compact
 * JSON instead of human-readable output, breaking command assertions.
 */
process.env.CI = process.env.CI ?? "1";
