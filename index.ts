/**
 * todo4-openclaw-plugin — entry point.
 *
 * Registers four agent tools (todo4_register, todo4_verify_otp, todo4_connect,
 * todo4_status) and installs a bundled `work-with-todo4` skill into
 * ~/.openclaw/skills/ on first load.
 *
 * Onboarding mirrors the existing openclaw-onboard skill (email -> OTP -> agent
 * connect, hitting the Todo4 API at https://todo4.io/api/v1) but exposes each
 * step as a typed plugin tool instead of a bash script. The OTP cookie, agent
 * token, and MCP config writes follow the same on-disk contract so users can
 * mix the skill and the plugin.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";

import { installBundledSkills } from "./src/io.js";
import {
  todo4Connect,
  todo4Register,
  todo4Status,
  todo4VerifyOtp,
} from "./src/tools.js";

const PLUGIN_ROOT = path.dirname(fileURLToPath(import.meta.url));

export default definePluginEntry({
  id: "todo4",
  register(api) {
    api.registerTool({
      name: "todo4_register",
      description:
        "Start Todo4 onboarding by sending a one-time verification code to the user's email. " +
        "Call this when the user asks to sign up for, install, connect, or get started with Todo4. " +
        "Always call todo4_verify_otp next.",
      parameters: Type.Object({
        email: Type.String({ description: "The user's email address." }),
      }),
      async execute(_id, params) {
        return todo4Register(params);
      },
    });

    api.registerTool({
      name: "todo4_verify_otp",
      description:
        "Verify the 6-digit code the user received by email. On success, returns an ephemeral " +
        "accessToken — immediately pass it to todo4_connect. Do not log, echo, or persist the token.",
      parameters: Type.Object({
        email: Type.String({ description: "Email used in todo4_register." }),
        code: Type.String({ description: "6-digit verification code." }),
      }),
      async execute(_id, params) {
        return todo4VerifyOtp(params);
      },
    });

    api.registerTool({
      name: "todo4_connect",
      description:
        "Register this OpenClaw instance as a Todo4 agent and wire up MCP. Writes the MCP server " +
        "entry into ~/.openclaw/mcp_config.json (deep-merge, preserves other servers) and stores " +
        "the agent token in ~/.openclaw/.env. Call after todo4_verify_otp succeeds, passing the " +
        "returned accessToken.",
      parameters: Type.Object({
        accessToken: Type.String({
          description: "Access token returned by todo4_verify_otp.",
        }),
        agentName: Type.Optional(
          Type.String({ description: "Display name (default: 'OpenClaw')." }),
        ),
      }),
      async execute(_id, params) {
        return todo4Connect(params);
      },
    });

    api.registerTool({
      name: "todo4_status",
      description:
        "Check whether Todo4 is configured for this OpenClaw install: agent token present, MCP " +
        "server entry exists, and Todo4 API is reachable. Use to self-diagnose before MCP calls or " +
        "before re-running onboarding.",
      parameters: Type.Object({}),
      async execute() {
        return todo4Status();
      },
    });

    try {
      installBundledSkills(PLUGIN_ROOT);
    } catch (err) {
      // Never fail registration over skill install; the tools still work.
      console.warn("[todo4] Could not install bundled skills:", err);
    }
  },
});
