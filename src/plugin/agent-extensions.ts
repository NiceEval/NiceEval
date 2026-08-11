// Receiver-branded constructors for the two built-in coding-agent adapters.
// They keep adapter-native config fragments opaque to core while exposing a
// canonical, credential-free behavior projection for configHash.

import type { ClaudeCodeConfig, ClaudeCodePluginSpec } from "../agents/claude-code.ts";
import type { CodexConfig, CodexPluginSpec } from "../agents/codex.ts";
import type { McpServer, SkillSpec } from "../agents/types.ts";
import {
  sandboxCommandDeclarationOf,
  sandboxCommandIdentityJson,
  type SandboxCommand,
} from "../sandbox/commands.ts";
import type { JsonValue } from "../shared/types.ts";
import {
  agentExtensionDataOf,
  defineAgentExtension,
  type AgentExtension,
} from "./contracts.ts";

export interface CodexAgentExtensionInput {
  readonly skills?: readonly SkillSpec[];
  readonly plugins?: readonly CodexPluginSpec[];
  readonly configFile?: string;
  readonly env?: Readonly<globalThis.Record<string, string>>;
  readonly postSetup?: readonly SandboxCommand[];
  readonly preTeardown?: readonly SandboxCommand[];
  readonly mcpServers?: readonly McpServer[];
}

export interface ClaudeCodeAgentExtensionInput {
  readonly skills?: readonly SkillSpec[];
  readonly plugins?: readonly ClaudeCodePluginSpec[];
  readonly settingsFile?: string;
  readonly env?: Readonly<globalThis.Record<string, string>>;
  readonly postSetup?: readonly SandboxCommand[];
  readonly preTeardown?: readonly SandboxCommand[];
  readonly mcpServers?: readonly McpServer[];
}

export interface CodexAgentExtensionPayload extends CodexAgentExtensionInput {}
export interface ClaudeCodeAgentExtensionPayload extends ClaudeCodeAgentExtensionInput {}

function freezeRecord(value: Readonly<globalThis.Record<string, string>> | undefined): Readonly<globalThis.Record<string, string>> | undefined {
  return value === undefined ? undefined : Object.freeze({ ...value });
}

function cloneSkill(skill: SkillSpec): SkillSpec {
  return skill.kind === "local"
    ? Object.freeze({ kind: "local" as const, path: skill.path, ...(skill.name === undefined ? {} : { name: skill.name }) })
    : Object.freeze({
        kind: "repo" as const,
        source: skill.source,
        ...(skill.skills === undefined ? {} : { skills: Object.freeze([...skill.skills]) }),
        ...(skill.ref === undefined ? {} : { ref: skill.ref }),
      });
}

function cloneMcp(server: McpServer): McpServer {
  if ("url" in server && server.url !== undefined) {
    return Object.freeze({
      name: server.name,
      url: server.url,
      ...(server.headers === undefined ? {} : { headers: Object.freeze({ ...server.headers }) }),
    });
  }
  return Object.freeze({
    name: server.name,
    command: server.command,
    ...(server.args === undefined ? {} : { args: Object.freeze([...server.args]) }),
    ...(server.env === undefined ? {} : { env: Object.freeze({ ...server.env }) }),
  });
}

function safeUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value.replace(/\/\/[^/@]+@/, "//").replace(/[?#].*$/, "");
  }
}

function credentialFree(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(credentialFree)) as unknown as JsonValue;
  const out: globalThis.Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    if (/^(api[-_]?key|token|secret|password|authorization|headers?|env)$/i.test(key)) {
      if (key === "env" && child !== null && typeof child === "object" && !Array.isArray(child)) {
        out.envKeys = Object.keys(child).sort();
      } else if ((key === "headers" || key === "header") && child !== null && typeof child === "object" && !Array.isArray(child)) {
        out.headerKeys = Object.keys(child).sort();
      } else {
        out[`${key}Keys`] = [];
      }
      continue;
    }
    out[key] = credentialFree(child);
  }
  return Object.freeze(out);
}

function commandProjection(command: SandboxCommand): JsonValue {
  const declaration = sandboxCommandDeclarationOf(command);
  if (declaration.kind === "opaque") return Object.freeze({ kind: "opaque" });
  return Object.freeze({
    kind: "stable",
    id: declaration.identity.id,
    revision: declaration.identity.revision,
    inputs: credentialFree(sandboxCommandIdentityJson(declaration.identity.inputs)),
  });
}

function mcpProjection(servers: readonly McpServer[]): JsonValue {
  return Object.freeze(servers.map((server) => {
    if ("url" in server && server.url !== undefined) {
      return Object.freeze({
        name: server.name,
        kind: "http",
        url: safeUrl(server.url),
        ...(server.headers === undefined ? {} : { headerKeys: Object.keys(server.headers).sort() }),
      });
    }
    return Object.freeze({
      name: server.name,
      kind: "stdio",
      command: server.command,
      ...(server.args === undefined ? {} : { args: [...server.args] }),
      ...(server.env === undefined ? {} : { envKeys: Object.keys(server.env).sort() }),
    });
  })) as unknown as JsonValue;
}

function skillsProjection(skills: readonly SkillSpec[]): JsonValue {
  return Object.freeze(skills.map((skill) => skill.kind === "local"
    ? Object.freeze({ kind: "local", path: skill.path, ...(skill.name === undefined ? {} : { name: skill.name }) })
    : Object.freeze({
        kind: "repo",
        source: safeUrl(skill.source),
        ...(skill.ref === undefined ? {} : { ref: skill.ref }),
        ...(skill.skills === undefined ? {} : { skills: [...skill.skills] }),
      }))) as unknown as JsonValue;
}

function codexPluginsProjection(plugins: readonly CodexPluginSpec[]): JsonValue {
  return Object.freeze(plugins.map((plugin) => Object.freeze({
    marketplace: Object.freeze({
      name: plugin.marketplace.name,
      source: safeUrl(plugin.marketplace.source),
      ...(plugin.marketplace.ref === undefined ? {} : { ref: plugin.marketplace.ref }),
      ...(plugin.marketplace.sparse === undefined ? {} : { sparse: [...plugin.marketplace.sparse] }),
    }),
    name: plugin.name,
  }))) as unknown as JsonValue;
}

function claudePluginsProjection(plugins: readonly ClaudeCodePluginSpec[]): JsonValue {
  return Object.freeze(plugins.map((plugin) => Object.freeze({
    marketplace: Object.freeze({
      name: plugin.marketplace.name,
      source: safeUrl(plugin.marketplace.source),
      ...(plugin.marketplace.ref === undefined ? {} : { ref: plugin.marketplace.ref }),
    }),
    name: plugin.name,
  }))) as unknown as JsonValue;
}

function freezeCodexPayload(input: CodexAgentExtensionInput): CodexAgentExtensionPayload {
  return Object.freeze({
    ...(input.skills === undefined ? {} : { skills: Object.freeze(input.skills.map(cloneSkill)) }),
    ...(input.plugins === undefined ? {} : { plugins: Object.freeze(input.plugins.map((plugin) => Object.freeze({
      marketplace: Object.freeze({
        name: plugin.marketplace.name,
        source: plugin.marketplace.source,
        ...(plugin.marketplace.ref === undefined ? {} : { ref: plugin.marketplace.ref }),
        ...(plugin.marketplace.sparse === undefined ? {} : { sparse: Object.freeze([...plugin.marketplace.sparse]) }),
      }),
      name: plugin.name,
    }))) }),
    ...(input.configFile === undefined ? {} : { configFile: input.configFile }),
    ...(input.env === undefined ? {} : { env: freezeRecord(input.env)! }),
    ...(input.postSetup === undefined ? {} : { postSetup: Object.freeze([...input.postSetup]) }),
    ...(input.preTeardown === undefined ? {} : { preTeardown: Object.freeze([...input.preTeardown]) }),
    ...(input.mcpServers === undefined ? {} : { mcpServers: Object.freeze(input.mcpServers.map(cloneMcp)) }),
  });
}

function freezeClaudePayload(input: ClaudeCodeAgentExtensionInput): ClaudeCodeAgentExtensionPayload {
  return Object.freeze({
    ...(input.skills === undefined ? {} : { skills: Object.freeze(input.skills.map(cloneSkill)) }),
    ...(input.plugins === undefined ? {} : { plugins: Object.freeze(input.plugins.map((plugin) => Object.freeze({
      marketplace: Object.freeze({
        name: plugin.marketplace.name,
        source: plugin.marketplace.source,
        ...(plugin.marketplace.ref === undefined ? {} : { ref: plugin.marketplace.ref }),
      }),
      name: plugin.name,
    }))) }),
    ...(input.settingsFile === undefined ? {} : { settingsFile: input.settingsFile }),
    ...(input.env === undefined ? {} : { env: freezeRecord(input.env)! }),
    ...(input.postSetup === undefined ? {} : { postSetup: Object.freeze([...input.postSetup]) }),
    ...(input.preTeardown === undefined ? {} : { preTeardown: Object.freeze([...input.preTeardown]) }),
    ...(input.mcpServers === undefined ? {} : { mcpServers: Object.freeze(input.mcpServers.map(cloneMcp)) }),
  });
}

/** Construct a Codex-only extension. It cannot be attached to Claude Code. */
export function codexAgentExtension(input: CodexAgentExtensionInput): AgentExtension<"codex"> {
  const payload = freezeCodexPayload(input);
  return defineAgentExtension({
    receiver: "codex",
    behaviorRevision: "codex-agent-extension-v1",
    payload,
    projection: Object.freeze({
      kind: "codex",
      ...(payload.skills === undefined ? {} : { skills: skillsProjection(payload.skills) }),
      ...(payload.plugins === undefined ? {} : { plugins: codexPluginsProjection(payload.plugins) }),
      ...(payload.configFile === undefined ? {} : { configFile: payload.configFile }),
      ...(payload.env === undefined ? {} : { envKeys: Object.keys(payload.env).sort() }),
      ...(payload.postSetup === undefined ? {} : { postSetup: payload.postSetup.map(commandProjection) }),
      ...(payload.preTeardown === undefined ? {} : { preTeardown: payload.preTeardown.map(commandProjection) }),
      ...(payload.mcpServers === undefined ? {} : { mcpServers: mcpProjection(payload.mcpServers) }),
    }) as unknown as JsonValue,
  });
}

/** Construct a Claude Code-only extension. It cannot be attached to Codex. */
export function claudeCodeAgentExtension(input: ClaudeCodeAgentExtensionInput): AgentExtension<"claude-code"> {
  const payload = freezeClaudePayload(input);
  return defineAgentExtension({
    receiver: "claude-code",
    behaviorRevision: "claude-code-agent-extension-v1",
    payload,
    projection: Object.freeze({
      kind: "claude-code",
      ...(payload.skills === undefined ? {} : { skills: skillsProjection(payload.skills) }),
      ...(payload.plugins === undefined ? {} : { plugins: claudePluginsProjection(payload.plugins) }),
      ...(payload.settingsFile === undefined ? {} : { settingsFile: payload.settingsFile }),
      ...(payload.env === undefined ? {} : { envKeys: Object.keys(payload.env).sort() }),
      ...(payload.postSetup === undefined ? {} : { postSetup: payload.postSetup.map(commandProjection) }),
      ...(payload.preTeardown === undefined ? {} : { preTeardown: payload.preTeardown.map(commandProjection) }),
      ...(payload.mcpServers === undefined ? {} : { mcpServers: mcpProjection(payload.mcpServers) }),
    }) as unknown as JsonValue,
  });
}

/** Explicit aliases make both construction and receiver role visible at call sites. */
export const defineCodexAgentExtension = codexAgentExtension;
export const defineClaudeCodeAgentExtension = claudeCodeAgentExtension;

export function codexExtensionPayload(extension: AgentExtension<"codex">): CodexAgentExtensionPayload {
  const data = agentExtensionDataOf(extension);
  if (data.receiver !== "codex") throw new TypeError("Expected a Codex AgentExtension.");
  return data.payload as CodexAgentExtensionPayload;
}

export function claudeCodeExtensionPayload(extension: AgentExtension<"claude-code">): ClaudeCodeAgentExtensionPayload {
  const data = agentExtensionDataOf(extension);
  if (data.receiver !== "claude-code") throw new TypeError("Expected a Claude Code AgentExtension.");
  return data.payload as ClaudeCodeAgentExtensionPayload;
}

/** Narrow adapter config projections used by receiver implementation. */
export type PluginCodexConfig = Pick<CodexConfig, "skills" | "plugins" | "configFile" | "env" | "postSetup" | "preTeardown" | "mcpServers">;
export type PluginClaudeCodeConfig = Pick<ClaudeCodeConfig, "skills" | "plugins" | "settingsFile" | "env" | "postSetup" | "preTeardown" | "mcpServers">;
