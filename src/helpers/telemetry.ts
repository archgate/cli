// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * telemetry.ts — Anonymous usage analytics via PostHog Node SDK.
 *
 * Uses the official posthog-node SDK for event capture with automatic
 * batching and flush. Events are captured during command execution and
 * flushed before process exit.
 *
 * IP anonymization: the CLI sends `$ip: null` on every event to signal
 * PostHog to resolve geo server-side then discard the IP. The project
 * also has "Discard client IP data" enabled in PostHog settings.
 *
 * See https://cli.archgate.dev/reference/telemetry for the full privacy policy.
 */

import { basename } from "node:path";

import type { PostHog } from "posthog-node";

import packageJson from "../../package.json";
import { detectInstallMethod, getProjectContext } from "./install-info";
import { logDebug } from "./log";
import { getPlatformInfo } from "./platform";
import type { RepoContext } from "./repo";
import { getRepoContext } from "./repo";
import { captureException } from "./sentry";
import { getInstallId, isTelemetryEnabled } from "./telemetry-config";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * PostHog project API key (write-only, safe to embed in client code).
 * This key can only ingest events — it cannot read data or manage the project.
 */
const POSTHOG_API_KEY = "phc_gSnjpsvRfQggmgeXUgbevbG0SULK5rT9gTZ8m3yjknv";
/**
 * Managed reverse-proxy for PostHog ingest. Routes through our own domain
 * instead of hitting eu.i.posthog.com directly — better reputation with
 * corporate proxies and ad-blockers, and lets us control the endpoint.
 */
const POSTHOG_HOST = "https://n.archgate.dev";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let client: PostHog | null = null;
let initialized = false;
let distinctId = "";

/**
 * Repo context resolved once at startup. Kept in module state so the sync
 * `getCommonProperties()` path doesn't need to await anything — reading git
 * config via subprocess isn't expensive but doing it per event would add up.
 */
let repoContextSnapshot: RepoContext | null = null;

// ---------------------------------------------------------------------------
// Environment enrichment
// ---------------------------------------------------------------------------

/**
 * Best-effort classification of the CI environment. PostHog already tells us
 * `is_ci`, but knowing whether a user is on GitHub Actions vs. GitLab CI vs.
 * a self-hosted runner is load-bearing context for understanding usage.
 */
function detectCiProvider(): string | null {
  if (Bun.env.GITHUB_ACTIONS) return "github-actions";
  if (Bun.env.GITLAB_CI) return "gitlab-ci";
  if (Bun.env.CIRCLECI) return "circleci";
  if (Bun.env.TRAVIS) return "travis";
  if (Bun.env.BUILDKITE) return "buildkite";
  if (Bun.env.JENKINS_URL || Bun.env.JENKINS_HOME) return "jenkins";
  if (Bun.env.BITBUCKET_BUILD_NUMBER) return "bitbucket-pipelines";
  if (Bun.env.TF_BUILD) return "azure-pipelines";
  if (Bun.env.TEAMCITY_VERSION) return "teamcity";
  if (Bun.env.CODEBUILD_BUILD_ID) return "aws-codebuild";
  if (Bun.env.CI) return "other";
  return null;
}

function detectShell(): string | null {
  const shell = Bun.env.SHELL;
  if (shell) return basename(shell);
  // PowerShell / cmd.exe don't expose SHELL — fall back to PSModulePath / ComSpec
  if (Bun.env.PSModulePath) return "powershell";
  if (Bun.env.ComSpec) return basename(Bun.env.ComSpec).toLowerCase();
  return null;
}

function detectLocale(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return Bun.env.LANG ?? null;
  }
}

// ---------------------------------------------------------------------------
// Shared properties
// ---------------------------------------------------------------------------

/**
 * Cache of the slow-changing portion of the common event properties. Platform
 * detection, install-method detection, CI detection, and locale resolution
 * are all effectively constant for the lifetime of a CLI invocation, so we
 * compute them once and reuse across events.
 *
 * The project context and repo snapshot are intentionally NOT cached here:
 *   - project context changes when `archgate init` creates the directory
 *     mid-command, so we always re-read it.
 *   - repo context lives in `repoContextSnapshot` which is written by
 *     `initTelemetry`.
 */
let staticPropertiesSnapshot: Record<string, unknown> | null = null;

function getStaticProperties(): Record<string, unknown> {
  if (staticPropertiesSnapshot) return staticPropertiesSnapshot;

  const { runtime, isWSL } = getPlatformInfo();
  staticPropertiesSnapshot = {
    // --- CLI / runtime ---
    cli_version: packageJson.version,
    os: runtime,
    arch: process.arch,
    bun_version: Bun.version,
    install_method: detectInstallMethod(),
    // --- Environment ---
    is_ci: Boolean(Bun.env.CI),
    ci_provider: detectCiProvider(),
    is_tty: Boolean(process.stdout.isTTY),
    is_wsl: isWSL,
    shell: detectShell(),
    locale: detectLocale(),
    // --- Geo privacy ---
    // Signal PostHog to resolve geo then discard the IP
    $ip: null,
  };
  return staticPropertiesSnapshot;
}

function getCommonProperties(): Record<string, unknown> {
  const ctx = getProjectContext();
  const repo = repoContextSnapshot;

  return {
    ...getStaticProperties(),
    // --- Project (re-read every event; `archgate init` can mutate this
    //     mid-invocation, and the read is a single readdirSync) ---
    has_project: ctx.hasProject,
    adr_count: ctx.adrCount,
    adr_with_rules_count: ctx.adrWithRulesCount,
    adr_domains_count: ctx.domains.length,
    // --- Repo identity (non-identifying) ---
    repo_is_git: repo?.isGit ?? false,
    repo_host: repo?.host ?? null,
    repo_id: repo?.repoId ?? null,
    git_default_branch: repo?.defaultBranch ?? null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize telemetry. Call once at CLI startup.
 * If telemetry is disabled, this is a no-op and all subsequent calls are too.
 *
 * Returns a promise that resolves once the async repo-context lookup is done.
 * Callers should `await` before emitting events so every event carries
 * `repo_id` / `repo_host` — emitting before the await resolves means the
 * event ships without repo identity. The repo lookup runs a handful of git
 * subprocesses (cached per-process), so the added startup latency is small.
 */
export async function initTelemetry(): Promise<void> {
  if (!isTelemetryEnabled()) {
    logDebug("Telemetry disabled — skipping init");
    return;
  }

  distinctId = getInstallId();

  // Kick off the repo-context resolution in parallel with the dynamic SDK
  // import. The caller awaits this whole function before `command_executed`
  // is emitted (see PR #211) so the snapshot lands before the first event.
  const repoContextPromise = getRepoContext()
    .then((ctx) => {
      repoContextSnapshot = ctx;
    })
    .catch((err) => {
      logDebug("Repo context resolution failed (ignored):", String(err));
    });

  try {
    // Lazy-load the PostHog SDK so the `ARCHGATE_TELEMETRY=0` path never pays
    // the module-parse cost (noticeable on cold starts / WSL).
    const { PostHog } = await import("posthog-node");
    client = new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      // Disable polling for feature flags — we don't use them in the CLI
      disableGeoip: false,
      flushAt: 20,
      // Disable automatic interval-based flushing. The CLI runs a single
      // command and exits — we flush explicitly via `client.shutdown()` in
      // `flushTelemetry()`. A 10s auto-flush timer is harmful: if the user
      // is behind a corporate proxy with SSL inspection (self-signed cert),
      // the timer fires mid-command and the PostHog SDK logs the TLS error
      // via stderr, dumping an ugly stack trace into the CLI output.
      flushInterval: 0,
      // Wrap fetch so network / TLS errors never reach the PostHog SDK's
      // internal logFlushError → stderr path. Telemetry is
      // non-critical: silently dropping events is preferable to printing
      // unactionable errors (e.g. SELF_SIGNED_CERT_IN_CHAIN behind a
      // corporate proxy).
      fetch: async (url, options) => {
        try {
          return await fetch(url, options);
        } catch (err) {
          logDebug("Telemetry fetch failed (silently ignored):", String(err));
          // Report to Sentry so we can track how often users hit TLS /
          // proxy / network issues — but never surface it to the user.
          captureException(err, { source: "posthog-fetch", url: String(url) });
          // Return a synthetic success so the SDK removes events from its
          // queue instead of retrying into the same broken network path.
          return {
            status: 200,
            text: () => Promise.resolve("ok"),
            json: () => Promise.resolve({}),
          };
        }
      },
    });

    initialized = true;
    logDebug("Telemetry initialized:", distinctId);
  } catch {
    logDebug("Telemetry init failed (silently ignored)");
  }

  await repoContextPromise;
}

/**
 * Returns true when the process is running under `bun test`.
 * Guards against tests emitting real events into the prod PostHog project —
 * matches the `NODE_ENV=test` pattern ARCH-005 already requires for Sentry.
 */
function isTestEnvironment(): boolean {
  return Bun.env.NODE_ENV === "test";
}

/**
 * Track a named event with optional properties.
 * No-op if telemetry is disabled.
 */
export function trackEvent(
  event: string,
  properties?: Record<string, unknown>
): void {
  if (!initialized || !client) return;
  if (isTestEnvironment()) return;

  try {
    client.capture({
      distinctId,
      event,
      properties: { ...getCommonProperties(), ...properties },
    });
    logDebug("Telemetry event captured:", event);
  } catch {
    // Silently ignore — telemetry must never affect CLI behavior
  }
}

/**
 * Track a CLI command invocation with the options used.
 * Option values are reduced to booleans/presence — no user data is sent.
 */
export function trackCommand(
  command: string,
  options?: Record<string, unknown>
): void {
  trackEvent("command_executed", { command, ...options });
}

/**
 * Track command completion with exit code and duration.
 *
 * `extra` carries the outcome classification (`success` / `user_error` /
 * `internal_error` / `cancelled`) and an optional `error_kind` bucket. This
 * keeps the event shape uniform whether the command exits via the Commander
 * `postAction` hook (happy path) or via `exitWith()` (failure path).
 */
export function trackCommandResult(
  command: string,
  exitCode: number,
  durationMs: number,
  extra?: Record<string, unknown>
): void {
  trackEvent("command_completed", {
    command,
    exit_code: exitCode,
    duration_ms: durationMs,
    ...extra,
  });
}

/**
 * Track the outcome of `archgate check`.
 * Captures aggregate counts — no file paths or violation content.
 */
export function trackCheckResult(properties: {
  total_rules: number;
  passed: number;
  failed: number;
  warnings: number;
  errors: number;
  rule_errors: number;
  pass: boolean;
  output_format: "console" | "json" | "ci";
  used_staged: boolean;
  used_file_filter: boolean;
  used_adr_filter: boolean;
  files_scanned?: number;
  load_duration_ms?: number;
  check_duration_ms?: number;
}): void {
  trackEvent("check_completed", properties);
}

/**
 * Track the outcome of `archgate init`.
 */
export function trackInitResult(properties: {
  editor: string;
  plugin_installed: boolean;
  plugin_auto_installed: boolean;
  had_existing_project: boolean;
}): void {
  trackEvent("init_completed", properties);
}

/**
 * Track the `project_initialized` event on `archgate init`.
 *
 * Identity (raw remote URL / owner / name) ships only when the repo is
 * confirmed public on a recognised host AND the user has not opted out via
 * `--no-share-repo-identity` or `ARCHGATE_SHARE_REPO_IDENTITY=0`. The hashed
 * `repo_id` is always included via common properties — it lets us count
 * repos without learning names.
 */
export function trackProjectInitialized(properties: {
  editors: string[];
  editor_primary: string;
  plugin_installed: boolean;
  had_existing_project: boolean;
  identity_shared: boolean;
  /** Repo host as classified by `parseRemoteUrl`; null if no remote. */
  repo_host: string | null;
  repo_is_git: boolean;
  /**
   * Public-visibility probe: `true`/`false` if determined via the host API,
   * `null` for self-hosted, unknown, network failure, or rate-limited.
   */
  repo_public: boolean | null;
  /** Only populated when `identity_shared` is true. */
  remote_url?: string | null;
  repo_owner?: string | null;
  repo_name?: string | null;
}): void {
  trackEvent("project_initialized", properties);
}

/**
 * Track the outcome of `archgate upgrade`.
 */
export function trackUpgradeResult(properties: {
  from_version: string;
  to_version: string;
  install_method: string;
  success: boolean;
  prompted_by_update_check?: boolean;
  failure_reason?: string;
}): void {
  trackEvent("upgrade_completed", properties);
}

/**
 * Track the outcome of `archgate login`.
 */
export function trackLoginResult(properties: {
  subcommand: "login" | "logout" | "refresh" | "status";
  success: boolean;
  failure_reason?: "network" | "tls" | "denied" | "other";
}): void {
  trackEvent("login_completed", properties);
}

/**
 * Track preference changes so we can measure opt-out rate. Fires one last
 * event right before disabling telemetry, and a fresh event when re-enabling.
 */
export function trackTelemetryPreferenceChange(properties: {
  enabled: boolean;
}): void {
  trackEvent("telemetry_preference_changed", properties);
}

/**
 * Track registration of a custom ADR domain. The domain name and prefix are
 * architectural category labels (e.g. "security" / "SEC"), not user data —
 * capturing them lets us see which categories repos adopt outside the
 * built-in five and informs whether to promote any to defaults.
 */
export function trackCustomDomainAdded(properties: {
  domain_name: string;
  prefix: string;
  total_custom_domains: number;
}): void {
  trackEvent("custom_domain_added", properties);
}

export function trackCustomDomainRemoved(properties: {
  domain_name: string;
  prefix: string;
  total_custom_domains: number;
}): void {
  trackEvent("custom_domain_removed", properties);
}

/**
 * Flush pending events to PostHog. Call before process exit to ensure
 * events are delivered.
 */
export async function flushTelemetry(timeoutMs = 3000): Promise<void> {
  if (!initialized || !client) return;

  try {
    logDebug("Flushing telemetry events");
    // Race shutdown against a timeout to prevent hanging on exit.
    //
    // The timeout MUST be cancelled when shutdown wins — a dangling
    // `setTimeout` keeps the Bun/Node event loop alive for its full
    // duration, which used to add 3s of latency to every command that
    // exited via `main()` returning naturally (instead of `process.exit`).
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        client.shutdown(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    logDebug("Telemetry flushed");
  } catch {
    // Silently ignore — telemetry must never affect CLI behavior
    logDebug("Telemetry flush failed (silently ignored)");
  }
}

// ---------------------------------------------------------------------------
// Testing helpers
// ---------------------------------------------------------------------------

/** Reset telemetry state. For testing only. */
export function _resetTelemetry(): void {
  if (client) {
    client.shutdown().catch(() => {});
  }
  client = null;
  initialized = false;
  distinctId = "";
  repoContextSnapshot = null;
  staticPropertiesSnapshot = null;
}

/** Get the PostHog client instance. For testing only. */
export function _getClient(): PostHog | null {
  return client;
}
