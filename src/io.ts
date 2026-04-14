/**
 * Filesystem helpers for writing OpenClaw config + .env atomically.
 *
 * - `writeMcpConfig` merges the todo4 entry into ~/.openclaw/openclaw.json
 *   under `mcp.servers.todo4`, preserving every other key in the config.
 *   (Per https://docs.openclaw.ai/cli/mcp — MCP servers live inside the
 *   main OpenClaw config, not in a separate mcp_config.json.)
 * - `writeEnvToken` rewrites the TODO4_AGENT_TOKEN line in ~/.openclaw/.env,
 *   preserves other lines, and chmods the file to 0o600.
 * - `installBundledSkills` copies bundled SKILL.md files into ~/.openclaw/skills/<name>/.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ENV_TOKEN_KEY,
  SERVER_NAME,
  getEnvFile,
  getMcporterConfigPath,
  getOpenclawConfigPath,
  getSkillsDir,
} from "./config.js";

export function writeMcpConfig(todo4Entry: Record<string, unknown>): void {
  const configPath = getOpenclawConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, "utf8");
    if (raw.trim().length) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          existing = parsed as Record<string, unknown>;
        } else {
          throw new Error(`Existing ${configPath} is not a JSON object`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Could not parse existing ${configPath}: ${message}`);
      }
    }
  }

  const mcpBlock: Record<string, unknown> =
    existing.mcp && typeof existing.mcp === "object" && !Array.isArray(existing.mcp)
      ? { ...(existing.mcp as Record<string, unknown>) }
      : {};
  const servers: Record<string, unknown> =
    mcpBlock.servers && typeof mcpBlock.servers === "object" && !Array.isArray(mcpBlock.servers)
      ? { ...(mcpBlock.servers as Record<string, unknown>) }
      : {};
  servers[SERVER_NAME] = todo4Entry;
  mcpBlock.servers = servers;
  existing.mcp = mcpBlock;

  atomicWrite(configPath, JSON.stringify(existing, null, 2) + "\n", 0o644);
}

/**
 * Register the server in mcporter's workspace config so the agent's tool-call
 * path (which goes through mcporter, not openclaw.json) sees it. Shape matches
 * what `mcporter config add --url --header` produces:
 *
 *   { "mcpServers": { "todo4": { "baseUrl": "...", "headers": { ... } } } }
 *
 * IMPORTANT: the raw agent token is embedded directly in the Authorization
 * header — not ${TODO4_AGENT_TOKEN} as we do in openclaw.json. Here's why:
 * mcporter does env-var substitution only from the invoking process's
 * environment, not from ~/.openclaw/.env. If OpenClaw's agent spawns
 * mcporter without exporting the token (the current default), mcporter
 * can't resolve the reference, silently falls back to its OAuth token
 * cache, and re-uses a stale cached token that was later superseded by
 * the newer agent-connect call. The server then returns
 * "Agent has been revoked" and the user is stuck.
 * File is chmod 0o600 to compensate for the token living in plaintext.
 */
export function writeMcporterConfig(entry: { url: string; rawToken: string }): void {
  const configPath = getMcporterConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, "utf8");
    if (raw.trim().length) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          existing = parsed as Record<string, unknown>;
        } else {
          throw new Error(`Existing ${configPath} is not a JSON object`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Could not parse existing ${configPath}: ${message}`);
      }
    }
  }

  const servers: Record<string, unknown> =
    existing.mcpServers && typeof existing.mcpServers === "object" && !Array.isArray(existing.mcpServers)
      ? { ...(existing.mcpServers as Record<string, unknown>) }
      : {};
  servers[SERVER_NAME] = {
    baseUrl: entry.url,
    headers: { Authorization: `Bearer ${entry.rawToken}` },
  };
  existing.mcpServers = servers;

  atomicWrite(configPath, JSON.stringify(existing, null, 2) + "\n", 0o600);
}

/**
 * Purge mcporter's cached OAuth tokens for this server so the next call
 * uses the Bearer header we just wrote, not a stale cached access_token
 * from a prior onboarding round.
 */
export function clearMcporterCredentials(): void {
  const credPath = path.join(os.homedir(), ".mcporter", "credentials.json");
  if (!fs.existsSync(credPath)) return;
  try {
    const raw = fs.readFileSync(credPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.entries) return;
    const filtered: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(parsed.entries)) {
      const asStr = JSON.stringify(val);
      if (key.startsWith(`${SERVER_NAME}|`) || key.startsWith(`${SERVER_NAME}-`)) continue;
      if (asStr.includes("todo4.io") || asStr.includes("todo-web-staging")) continue;
      filtered[key] = val;
    }
    parsed.entries = filtered;
    atomicWrite(credPath, JSON.stringify(parsed, null, 2) + "\n", 0o600);
  } catch {
    // Silent: stale cache is recoverable, and this is a best-effort cleanup.
  }
}

export function mcporterConfigHasTodo4(): boolean {
  const configPath = getMcporterConfigPath();
  if (!fs.existsSync(configPath)) return false;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object") return false;
    const servers = (parsed as Record<string, unknown>).mcpServers;
    return !!(servers && typeof servers === "object" && (servers as Record<string, unknown>)[SERVER_NAME]);
  } catch {
    return false;
  }
}

export function writeEnvToken(token: string): void {
  const envPath = getEnvFile();
  fs.mkdirSync(path.dirname(envPath), { recursive: true });

  const lines: string[] = [];
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const stripped = line.replace(/^\s+/, "");
      if (stripped.startsWith(`${ENV_TOKEN_KEY}=`)) continue;
      if (stripped.startsWith(`export ${ENV_TOKEN_KEY}=`)) continue;
      if (line.length > 0) lines.push(line);
    }
  }
  lines.push(`${ENV_TOKEN_KEY}=${token}`);
  atomicWrite(envPath, lines.join("\n") + "\n", 0o600);
}

export function envHasToken(): boolean {
  const envPath = getEnvFile();
  if (!fs.existsSync(envPath)) return false;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    let stripped = line.replace(/^\s+/, "");
    if (stripped.startsWith(`export ${ENV_TOKEN_KEY}=`)) {
      stripped = stripped.slice("export ".length);
    }
    if (stripped.startsWith(`${ENV_TOKEN_KEY}=`)) {
      const value = stripped.slice(`${ENV_TOKEN_KEY}=`.length).trim().replace(/^["']|["']$/g, "");
      return value.length > 0;
    }
  }
  return false;
}

export function mcpConfigHasTodo4(): boolean {
  const configPath = getOpenclawConfigPath();
  if (!fs.existsSync(configPath)) return false;
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    if (!raw.trim().length) return false;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return false;
    const mcp = (parsed as Record<string, unknown>).mcp;
    if (!mcp || typeof mcp !== "object") return false;
    const servers = (mcp as Record<string, unknown>).servers;
    return !!(servers && typeof servers === "object" && (servers as Record<string, unknown>)[SERVER_NAME]);
  } catch {
    return false;
  }
}

/**
 * Copy each <pluginRoot>/skills/<skill>/SKILL.md to ~/.openclaw/skills/<skill>/SKILL.md.
 * Always overwrite so plugin updates propagate. Returns the list of skill names installed.
 */
export function installBundledSkills(pluginRoot: string): string[] {
  const src = path.join(pluginRoot, "skills");
  if (!fs.existsSync(src)) return [];
  const dest = getSkillsDir();
  fs.mkdirSync(dest, { recursive: true });
  const installed: string[] = [];
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const srcSkill = path.join(src, entry.name, "SKILL.md");
    if (!fs.existsSync(srcSkill)) continue;
    const destSkillDir = path.join(dest, entry.name);
    fs.mkdirSync(destSkillDir, { recursive: true });
    fs.copyFileSync(srcSkill, path.join(destSkillDir, "SKILL.md"));
    installed.push(entry.name);
  }
  return installed;
}

function atomicWrite(target: string, content: string, mode: number): void {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, content, { encoding: "utf8", mode });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, target);
}
