/**
 * Path + env helpers for the Todo4 OpenClaw plugin.
 *
 * `TODO4_API_URL` defaults to https://todo4.io/api/v1 (matches the existing
 * openclaw-onboard skill so behaviour stays consistent across both flows).
 */
import os from "node:os";
import path from "node:path";

export const SERVER_NAME = "todo4";
export const AGENT_PLATFORM = "openclaw";
export const ENV_TOKEN_KEY = "TODO4_AGENT_TOKEN";
export const DEFAULT_API_URL = "https://todo4.io/api/v1";

export function getApiUrl(): string {
  return (process.env.TODO4_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, "");
}

export function getOpenclawHome(): string {
  return process.env.OPENCLAW_HOME ?? path.join(os.homedir(), ".openclaw");
}

/**
 * The real OpenClaw config file. MCP servers live under the `mcp.servers`
 * key here (per https://docs.openclaw.ai/cli/mcp), NOT in a separate
 * `mcp_config.json` — that file is unused by OpenClaw.
 */
export function getOpenclawConfigPath(): string {
  return path.join(getOpenclawHome(), "openclaw.json");
}

export function getEnvFile(): string {
  return path.join(getOpenclawHome(), ".env");
}

export function getSkillsDir(): string {
  return path.join(getOpenclawHome(), "skills");
}
