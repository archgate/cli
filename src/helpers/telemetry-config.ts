/**
 * telemetry-config.ts — Manages telemetry preferences in ~/.archgate/config.json.
 *
 * Telemetry is opt-out: enabled by default, users disable via:
 *   - ARCHGATE_TELEMETRY=0 environment variable
 *   - `archgate telemetry disable` command
 *
 * An anonymous installId (UUID v4) is generated on first use for aggregate
 * counting — it is not derived from any user data.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { logDebug } from "./log";
import { internalPath, createPathIfNotExists } from "./paths";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TelemetryConfig {
  /** Whether telemetry is enabled (default: true). */
  telemetry: boolean;
  /** Random UUID generated on first use — not derived from any user data. */
  installId: string;
  /** ISO date of first telemetry config creation. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const CONFIG_FILE = "config.json";

function configPath(): string {
  return internalPath(CONFIG_FILE);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let cachedConfig: TelemetryConfig | null = null;

// ---------------------------------------------------------------------------
// Environment variable override
// ---------------------------------------------------------------------------

/**
 * Returns true if the ARCHGATE_TELEMETRY env var explicitly disables telemetry.
 * Accepted values: "0", "false", "no", "off" (case-insensitive).
 */
export function isEnvTelemetryDisabled(): boolean {
  const envVal = Bun.env.ARCHGATE_TELEMETRY;
  if (envVal === undefined) return false;
  return ["0", "false", "no", "off"].includes(envVal.toLowerCase());
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if telemetry should be active for this invocation.
 * Checks env var first (fastest), then persisted config.
 */
export function isTelemetryEnabled(): boolean {
  if (isEnvTelemetryDisabled()) return false;
  const config = loadTelemetryConfig();
  return config.telemetry;
}

/**
 * Load or create the telemetry config from ~/.archgate/config.json.
 * The result is cached per process.
 */
export function loadTelemetryConfig(): TelemetryConfig {
  if (cachedConfig) return cachedConfig;

  // Synchronous read for startup-path performance
  try {
    const path = configPath();
    if (existsSync(path)) {
      const text = readFileSync(path, "utf-8");
      const parsed = JSON.parse(text) as Partial<TelemetryConfig>;
      if (parsed.installId && typeof parsed.telemetry === "boolean") {
        cachedConfig = {
          telemetry: parsed.telemetry,
          installId: parsed.installId,
          createdAt: parsed.createdAt ?? new Date().toISOString(),
        };
        logDebug("Telemetry config loaded:", cachedConfig.installId);
        return cachedConfig;
      }
    }
  } catch {
    // File doesn't exist or is malformed — create a new one
  }

  // First run: generate fresh config
  cachedConfig = {
    telemetry: true,
    installId: randomUUID(),
    createdAt: new Date().toISOString(),
  };

  // Persist asynchronously — don't block CLI startup
  saveTelemetryConfigAsync(cachedConfig);
  logDebug("Telemetry config created:", cachedConfig.installId);
  return cachedConfig;
}

/**
 * Update telemetry enabled/disabled state and persist to disk.
 */
export async function setTelemetryEnabled(enabled: boolean): Promise<void> {
  const config = loadTelemetryConfig();
  config.telemetry = enabled;
  cachedConfig = config;
  await saveTelemetryConfig(config);
}

/**
 * Get the anonymous install ID for this CLI installation.
 */
export function getInstallId(): string {
  return loadTelemetryConfig().installId;
}

// ---------------------------------------------------------------------------
// Persistence (internal)
// ---------------------------------------------------------------------------

async function saveTelemetryConfig(config: TelemetryConfig): Promise<void> {
  createPathIfNotExists(internalPath());
  await Bun.write(configPath(), JSON.stringify(config, null, 2) + "\n");
  logDebug("Telemetry config saved");
}

function saveTelemetryConfigAsync(config: TelemetryConfig): void {
  saveTelemetryConfig(config).catch(() => {
    // Silently ignore — telemetry config persistence is best-effort
  });
}

// ---------------------------------------------------------------------------
// Testing helpers
// ---------------------------------------------------------------------------

/** Reset cached config. For testing only. */
export function _resetConfigCache(): void {
  cachedConfig = null;
}
