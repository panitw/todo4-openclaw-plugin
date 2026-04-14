/**
 * Thin Todo4 API client. Catches network/HTTP errors and surfaces them as
 * `{ ok: false, error, ... }` results so plugin tools never throw — every
 * tool handler returns a structured result the LLM can reason about.
 */
import { getApiUrl } from "./config.js";

export interface ApiResult {
  ok: boolean;
  status?: number;
  body?: unknown;
  cookies?: Record<string, string>;
  error?: string;
  message?: string;
}

const TIMEOUT_MS = 15_000;

export async function postJson(
  pathSuffix: string,
  body: unknown,
  bearerToken?: string,
): Promise<ApiResult> {
  const url = `${getApiUrl()}${pathSuffix}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearerToken) headers["Authorization"] = `Bearer ${bearerToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: "manual",
    });
    const text = await resp.text();
    let parsed: unknown = null;
    if (text.length) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return {
      ok: resp.ok,
      status: resp.status,
      body: parsed,
      cookies: parseSetCookies(resp.headers),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: "network", message };
  } finally {
    clearTimeout(timer);
  }
}

export async function getJson(pathSuffix: string): Promise<ApiResult> {
  const url = `${getApiUrl()}${pathSuffix}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    return { ok: resp.ok, status: resp.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: "network", message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract Set-Cookie name=value pairs. Uses Headers.getSetCookie() when
 * available (Node 18.14+ / undici), otherwise falls back to a single header.
 */
function parseSetCookies(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  type WithGetSetCookie = Headers & { getSetCookie?: () => string[] };
  const h = headers as WithGetSetCookie;
  const list: string[] = typeof h.getSetCookie === "function" ? h.getSetCookie() : [];
  const single = headers.get("set-cookie");
  const all = list.length ? list : single ? [single] : [];
  for (const raw of all) {
    const firstPart = raw.split(";", 1)[0] ?? "";
    const eq = firstPart.indexOf("=");
    if (eq > 0) {
      const name = firstPart.slice(0, eq).trim();
      const value = firstPart.slice(eq + 1).trim();
      if (name) out[name] = value;
    }
  }
  return out;
}

export function extractRetryAfter(body: unknown): number | undefined {
  if (!body || typeof body !== "object") return undefined;
  const err = (body as Record<string, unknown>)["error"];
  if (!err || typeof err !== "object") return undefined;
  const details = (err as Record<string, unknown>)["details"];
  if (!details || typeof details !== "object") return undefined;
  const v = (details as Record<string, unknown>)["retryAfterSeconds"];
  return typeof v === "number" ? v : undefined;
}
