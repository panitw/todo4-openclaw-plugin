/**
 * Filesystem helpers for writing OpenClaw config + .env atomically.
 *
 * - `writeMcpConfig` deep-merges the todo4 entry into ~/.openclaw/mcp_config.json,
 *   preserving any other configured MCP servers.
 * - `writeEnvToken` rewrites the TODO4_AGENT_TOKEN line in ~/.openclaw/.env,
 *   preserves other lines, and chmods the file to 0o600.
 * - `installBundledSkills` copies bundled SKILL.md files into ~/.openclaw/skills/<name>/.
 */
import fs from "node:fs";
import path from "node:path";

import {
  ENV_TOKEN_KEY,
  SERVER_NAME,
  getEnvFile,
  getMcpConfigPath,
  getSkillsDir,
} from "./config.js";

export function writeMcpConfig(todo4Entry: Record<string, unknown>): void {
  const configPath = getMcpConfigPath();
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
    existing.mcpServers && typeof existing.mcpServers === "object"
      ? { ...(existing.mcpServers as Record<string, unknown>) }
      : {};
  servers[SERVER_NAME] = todo4Entry;
  existing.mcpServers = servers;

  atomicWrite(configPath, JSON.stringify(existing, null, 2) + "\n", 0o644);
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
  const configPath = getMcpConfigPath();
  if (!fs.existsSync(configPath)) return false;
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    if (!raw.trim().length) return false;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return false;
    const servers = (parsed as Record<string, unknown>).mcpServers;
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
