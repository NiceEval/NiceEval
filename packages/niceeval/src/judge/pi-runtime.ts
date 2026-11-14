// @concord-file
// @concord-implements docs/feature/judge/architecture.md
import { builtinContextWindow } from "../o11y/builtin-models.ts";
import { pathToFileURL } from "node:url";
import type { ResolvedJudgeConfig } from "../assertions/types.ts";
import type { AgentSession, ToolDefinition } from "@earendil-works/pi-coding-agent";
type CodingSdk = typeof import("@earendil-works/pi-coding-agent");

/** Creates an isolated coding-agent session. pi owns requests, tools, retries,
 * compaction and usage. No user files, resources or credentials are discovered. */
export async function createManagedPiSession(input: {
  readonly paths: { readonly coding: string };
  readonly profile: ResolvedJudgeConfig;
  readonly apiKey: string;
  readonly systemPrompt: string;
  readonly cwd?: string;
  readonly tools: readonly string[];
  readonly customTools: (sdk: CodingSdk) => ToolDefinition[];
}) {
  const sdk = await import(pathToFileURL(input.paths.coding).href) as CodingSdk;
  const profile = input.profile;
  if (profile.protocol.kind !== "chat-completions") throw new TypeError("pi requires a chat-completions provider");
  const cwd = input.cwd ?? "/";
  const contextWindow = profile.contextWindow ?? builtinContextWindow(profile.model) ?? Number.MAX_SAFE_INTEGER;
  const settingsManager = sdk.SettingsManager.inMemory();
  const sessionManager = sdk.SessionManager.inMemory(cwd);
  const modelRuntime = await sdk.ModelRuntime.create({ credentials: { read: async () => undefined, list: async () => [], modify: async (_provider, fn) => fn(undefined), delete: async () => {} }, modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  modelRuntime.registerProvider("niceeval-managed", { baseUrl: profile.baseUrl, headers: { ...profile.headers }, apiKey: input.apiKey,
    api: "openai-completions", models: [{ id: profile.model, name: profile.model, api: "openai-completions", reasoning: false,
      input: profile.supportsImages ? ["text", "image"] : ["text"], contextWindow, maxTokens: profile.protocol.maxOutputTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" } }] });
  const model = modelRuntime.getModel("niceeval-managed", profile.model);
  if (model === undefined) throw new Error("Managed pi model is unavailable");
  const resourceLoader = new sdk.DefaultResourceLoader({ cwd, agentDir: "/niceeval-no-agent-resources", settingsManager,
    noExtensions: true, disabledBuiltinExtensions: ["mcp"], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    systemPrompt: input.systemPrompt,
  });
  await resourceLoader.reload();
  const customTools = input.customTools(sdk);
  const { session } = await sdk.createAgentSession({ cwd, agentDir: "/niceeval-no-agent-resources", modelRuntime, model, scopedModels: [{ model }],
    settingsManager, sessionManager, resourceLoader, tools: [...new Set([...input.tools, ...customTools.map(tool => tool.name)])], customTools });
  return { session, sessionManager, sdk, contextWindow };
}

/** prompt() may return before pi's recovery loop finishes. The public settled
 * event closes the complete operation, including retries and auto compaction. */
export async function promptPiSession(session: AgentSession, text: string): Promise<void> {
  let unsubscribe = () => {};
  const settled = new Promise<void>(resolve => { unsubscribe = session.subscribe(event => { if (event.type === "agent_settled") resolve(); }); });
  try { await session.prompt(text); await settled; }
  finally { unsubscribe(); }
}
