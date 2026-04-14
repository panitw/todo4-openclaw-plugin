/**
 * Todo4 onboarding + status tools, exposed to the OpenClaw agent.
 *
 * Contract: every tool returns an `{ ok, ... }` JSON payload encoded as text
 * content. Handlers never throw — failure modes surface as `{ ok: false, error }`
 * so the LLM can branch in the `todo4-onboard` skill.
 *
 * The access token returned by `todo4_verify_otp` is ephemeral (1h expiry) and
 * only meant to be passed straight into `todo4_connect`. We do not persist it.
 */
import { extractRetryAfter, getJson, postJson } from "./api-client.js";
import { AGENT_PLATFORM, ENV_TOKEN_KEY, SERVER_NAME, getOpenclawConfigPath } from "./config.js";
import {
  envHasToken,
  mcpConfigHasTodo4,
  mcporterConfigHasTodo4,
  writeEnvToken,
  writeMcpConfig,
  writeMcporterConfig,
} from "./io.js";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type ToolResult = { content: Array<{ type: "text"; text: string }> };

function reply(payload: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function ok(extra: Record<string, unknown> = {}): ToolResult {
  return reply({ ok: true, ...extra });
}

function err(error: string, message: string, extra: Record<string, unknown> = {}): ToolResult {
  return reply({ ok: false, error, message, ...extra });
}

export async function todo4Register(params: { email?: unknown }): Promise<ToolResult> {
  const email = String(params.email ?? "").trim();
  if (!email) return err("missing_email", "Email is required.");
  if (!EMAIL_RE.test(email)) return err("invalid_email", "That doesn't look like a valid email.");
  const resp = await postJson("/auth/register-passwordless", { email });
  if (resp.error === "network") return err("network", resp.message ?? "Could not reach Todo4.");
  if (resp.status === 200 || resp.status === 201) return ok({ message: "Verification code sent." });
  if (resp.status === 429) {
    return err("rate_limited", "Too many requests. Please wait and try again.", {
      retryAfterSeconds: extractRetryAfter(resp.body),
    });
  }
  if (resp.status === 400) return err("invalid_email", "That email was rejected by Todo4.");
  return err("server", `Unexpected response (${resp.status ?? "?"}).`);
}

export async function todo4VerifyOtp(params: { email?: unknown; code?: unknown }): Promise<ToolResult> {
  const email = String(params.email ?? "").trim();
  const code = String(params.code ?? "").trim();
  if (!email || !code) return err("missing_args", "Email and code are required.");
  const resp = await postJson("/auth/verify-otp", { email, code });
  if (resp.error === "network") return err("network", resp.message ?? "Could not reach Todo4.");
  if (resp.status === 200) {
    const token = resp.cookies?.access_token;
    if (!token) return err("parse_error", "Verification succeeded but access_token cookie was missing.");
    return ok({ accessToken: token });
  }
  if (resp.status === 400) return err("invalid_code", "That code didn't work. Double-check and try again.");
  if (resp.status === 429) {
    return err("rate_limited", "Too many verification attempts. Please wait.", {
      retryAfterSeconds: extractRetryAfter(resp.body),
    });
  }
  return err("server", `Unexpected response (${resp.status ?? "?"}).`);
}

export async function todo4Connect(params: {
  accessToken?: unknown;
  agentName?: unknown;
}): Promise<ToolResult> {
  const accessToken = String(params.accessToken ?? "").trim();
  const agentName = String(params.agentName ?? "").trim() || "OpenClaw";
  if (!accessToken) return err("missing_args", "accessToken is required.");
  const resp = await postJson(
    "/auth/agent-connect",
    { agentName, agentPlatform: AGENT_PLATFORM },
    accessToken,
  );
  if (resp.error === "network") return err("network", resp.message ?? "Could not reach Todo4.");
  if (resp.status === 401) return err("unauthorized", "Access token was rejected. Restart onboarding.");
  if (resp.status === 422) {
    return err(
      "quota_exceeded",
      "This account has reached its agent limit. Manage agents at todo4.io.",
    );
  }
  if (resp.status === 429) {
    return err("rate_limited", "Too many connect attempts. Please wait.", {
      retryAfterSeconds: extractRetryAfter(resp.body),
    });
  }
  if (resp.status !== 200 && resp.status !== 201) {
    return err("server", `Unexpected response (${resp.status ?? "?"}).`);
  }

  const body = resp.body;
  if (!body || typeof body !== "object") return err("parse_error", "Response was not valid JSON.");
  const data = (body as Record<string, unknown>).data;
  const dataObj = data && typeof data === "object" ? (data as Record<string, unknown>) : {};

  const agentToken = dataObj.agentAccessToken;
  const snippet = dataObj.mcpConfigSnippet;
  const snippetObj = snippet && typeof snippet === "object" ? (snippet as Record<string, unknown>) : {};
  const servers = snippetObj.mcpServers;
  const serversObj = servers && typeof servers === "object" ? (servers as Record<string, unknown>) : {};
  const todo4Entry = serversObj[SERVER_NAME];

  if (typeof agentToken !== "string" || !agentToken || !todo4Entry || typeof todo4Entry !== "object") {
    return err("parse_error", "Missing agentAccessToken or mcpConfigSnippet in response.");
  }

  // Rewrite Authorization header so the raw token only lives in .env, not in mcp_config.json.
  const entry = { ...(todo4Entry as Record<string, unknown>) };
  const headersIn = entry.headers;
  const headersObj = headersIn && typeof headersIn === "object"
    ? { ...(headersIn as Record<string, unknown>) }
    : {};
  headersObj["Authorization"] = `Bearer \${${ENV_TOKEN_KEY}}`;
  entry.headers = headersObj;

  try {
    writeMcpConfig(entry);
    const urlValue = typeof entry.url === "string" ? entry.url : "";
    writeMcporterConfig({ url: urlValue, headers: headersObj });
    writeEnvToken(agentToken);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("not a JSON object")) {
      return err("config_conflict", message);
    }
    return err("io_error", `Could not write OpenClaw config: ${message}`);
  }

  const webLoginUrl = typeof dataObj.webLoginUrl === "string" ? dataObj.webLoginUrl : null;
  return ok({
    message: `Connected as '${agentName}'. The Todo4 MCP server was added to openclaw.json (mcp.servers.todo4) and mcporter.json (mcpServers.todo4). The raw agent token lives only in ~/.openclaw/.env.`,
    reloadHint: "Run `openclaw gateway restart` so the new MCP server is picked up.",
    webLoginUrl,
  });
}

export async function todo4Status(): Promise<ToolResult> {
  const tokenPresent = envHasToken();
  const openclawEntryPresent = mcpConfigHasTodo4();
  const mcporterEntryPresent = mcporterConfigHasTodo4();
  const probe = await getJson("/health");
  return ok({
    // mcporter entry is the one the agent actually uses; openclaw entry is for `openclaw mcp list`.
    configured: tokenPresent && mcporterEntryPresent,
    tokenPresent,
    mcporterEntryPresent,
    openclawEntryPresent,
    apiReachable: probe.ok,
    apiError: probe.error === "network" ? probe.message : undefined,
    openclawConfigPath: getOpenclawConfigPath(),
  });
}
