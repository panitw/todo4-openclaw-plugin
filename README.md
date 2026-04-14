# todo4-openclaw-plugin

OpenClaw plugin that onboards [Todo4](https://todo4.io) from chat and ships an MCP-aware work skill.

## What it does

- **Onboards Todo4 from chat** via four agent tools — email → OTP → agent connection, no browser or password required.
- **Wires up the Todo4 MCP server** — writes the server entry into `~/.openclaw/mcp_config.json` (deep-merge, preserves other servers) and stores the agent token in `~/.openclaw/.env`.
- **Bundles a `todo4-work` skill** — installed to `~/.openclaw/skills/todo4-work/SKILL.md` on plugin load. Tells the agent which Todo4 MCP tools to call (and which not to reach for) when the user asks task-related things.

This complements the existing [openclaw-onboard](https://github.com/panitw/todo4-onboard-skill) skill on ClawHub: that skill drives a conversational onboarding interview using bash scripts; this plugin exposes the same flow as typed agent tools so other skills/agents can invoke them programmatically.

## Install

```bash
openclaw plugins install https://github.com/panitw/todo4-openclaw-plugin
```

Restart OpenClaw (or reload plugins) so `register()` runs and the bundled `todo4-work` skill lands in `~/.openclaw/skills/`.

### Verify

```bash
openclaw plugins list | grep todo4
openclaw skills list  | grep todo4-work
```

## Usage

In chat, trigger onboarding by saying any of:

- "Run the todo4-onboard skill" (uses the existing ClawHub skill if installed)
- "Use `todo4_register` to sign me up — my email is you@example.com" (calls the plugin tool directly)

The flow asks for your email, sends a one-time code, verifies it, and connects this OpenClaw instance as your Todo4 agent. Restart OpenClaw afterwards (or reload the MCP config) so the new MCP server is picked up.

## Tools exposed to the agent

| Tool | Purpose |
|---|---|
| `todo4_register` | Send a one-time code to the user's email. |
| `todo4_verify_otp` | Verify the code and return an ephemeral `accessToken`. |
| `todo4_connect` | Register this OpenClaw instance as a Todo4 agent. Writes MCP config + `.env` token. Returns a one-time `webLoginUrl` for the user. |
| `todo4_status` | Report whether MCP is configured, token is present, and the API is reachable. |

## Bundled skill

| Skill | Where | Loads when |
|---|---|---|
| `todo4-work` | `~/.openclaw/skills/todo4-work/SKILL.md` (installed by this plugin) | The user mentions Todo4, their tasks, planning, or triage. |

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `TODO4_API_URL` | `https://todo4.io/api/v1` | Todo4 API base. Override for staging. |
| `OPENCLAW_HOME` | `~/.openclaw` | OpenClaw config root. Override for isolated testing. |
| `TODO4_AGENT_TOKEN` | *(set by the plugin)* | Agent bearer token, stored in `$OPENCLAW_HOME/.env`. |

## Security

| What the plugin does | With |
|---|---|
| Calls `POST /auth/register-passwordless` | User email only |
| Calls `POST /auth/verify-otp` | Email + 6-digit code |
| Calls `POST /auth/agent-connect` | Access-token JWT (ephemeral, 1-hour expiry) |
| Writes MCP config to `$OPENCLAW_HOME/mcp_config.json` | Deep-merge, preserves other MCP servers |
| Writes agent token to `$OPENCLAW_HOME/.env` | As `TODO4_AGENT_TOKEN=...`, file mode `0o600` |

The MCP config stores the authorization header as `Bearer ${TODO4_AGENT_TOKEN}` — the raw agent token only lives in `.env`, never in `mcp_config.json`.

Tool handlers never throw, never log secrets, and never return raw tokens in their response payload.

## Development

```bash
npm install
npx tsc --noEmit
```

(There's no build step at runtime — OpenClaw loads the `.ts` files directly via its plugin SDK loader.)

## License

MIT — see [LICENSE](LICENSE).
