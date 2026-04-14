/**
 * Local type declaration shim for the OpenClaw plugin SDK.
 *
 * The real `openclaw/plugin-sdk/*` modules are provided by the OpenClaw
 * runtime when it loads the plugin — they are not published to npm. This
 * shim covers only the surface this plugin uses (definePluginEntry +
 * registerTool) so `tsc --noEmit` works during local development.
 *
 * Update this file if/when this plugin starts using more SDK methods.
 */
declare module "openclaw/plugin-sdk/plugin-entry" {
  import type { TSchema, Static } from "@sinclair/typebox";

  export interface ToolContent {
    type: "text";
    text: string;
  }

  export interface ToolResult {
    content: ToolContent[];
  }

  export interface ToolDefinition<Schema extends TSchema = TSchema> {
    name: string;
    description: string;
    parameters: Schema;
    execute: (id: string, params: Static<Schema>) => Promise<ToolResult> | ToolResult;
  }

  export interface ToolRegisterOptions {
    optional?: boolean;
  }

  export interface PluginApi {
    registerTool<Schema extends TSchema>(
      tool: ToolDefinition<Schema>,
      options?: ToolRegisterOptions,
    ): void;
  }

  export interface PluginEntry {
    id: string;
    register: (api: PluginApi) => void | Promise<void>;
  }

  export function definePluginEntry(entry: PluginEntry): PluginEntry;
}
