// Effect-backed Plugin API. Deliberately not re-exported by the root entry.

export {
  definePlugin,
  defineSandboxResource,
  composeAgentExtensions,
} from "./contracts.ts";
export {
  claudeCodeAgentExtension,
  codexAgentExtension,
  defineClaudeCodeAgentExtension,
  defineCodexAgentExtension,
} from "./agent-extensions.ts";
export type {
  AgentExtension,
  AgentExtensionCommand,
  EvalPluginFragment,
  ExperimentPluginFragment,
  GroupPluginFragment,
  PluginDefinition,
  PluginInstance,
  PluginOnUnavailable,
  PluginOwner,
  PluginRequirement,
  SandboxResource,
  SandboxResourceAttemptContext,
  SandboxResourceContext,
  SandboxResourceDefinition,
  SandboxResourceDemand,
  SandboxResourceDemandPayload,
  SandboxResourceTiming,
} from "./contracts.ts";
export type {
  ClaudeCodeAgentExtensionInput,
  CodexAgentExtensionInput,
} from "./agent-extensions.ts";
