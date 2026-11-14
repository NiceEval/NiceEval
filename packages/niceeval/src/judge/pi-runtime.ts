// @concord-file
// @concord-implements docs/feature/judge/architecture.md
import { builtinContextWindow } from "../o11y/builtin-models.ts";
import { pathToFileURL } from "node:url";
import type { ResolvedJudgeConfig } from "../assertions/types.ts";
import type { AgentSession, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { PiFailure, piDefect, piUsageFailure } from "./pi-failure.ts";
import type { AssistantMessage } from "@earendil-works/pi-ai";
type CodingSdk = typeof import("@earendil-works/pi-coding-agent");

/** Creates an isolated coding-agent session. pi owns requests, tools, retries,
 * compaction and usage. No user files, resources or credentials are discovered. */
export async function createManagedPiSession(input: {
  readonly paths: { readonly coding: string; readonly ai: string };
  readonly profile: ResolvedJudgeConfig;
  readonly apiKey: string;
  readonly systemPrompt: string;
  readonly cwd?: string;
  readonly tools: readonly string[];
  readonly customTools: (sdk: CodingSdk) => ToolDefinition[];
}) {
  let sdk: CodingSdk;
  let ai: typeof import("@earendil-works/pi-ai");
  try {
    sdk = (await import(pathToFileURL(input.paths.coding).href)) as CodingSdk;
    ai = (await import(pathToFileURL(input.paths.ai).href)) as typeof ai;
  } catch (cause) {
    throw new PiFailure({ kind: "dependency", message: "pi dependency could not be loaded", cause });
  }
  try {
    const profile = input.profile;
    if (profile.protocol.kind !== "chat-completions") throw new TypeError("pi requires a chat-completions provider");
    const cwd = input.cwd ?? "/";
    const contextWindow = profile.contextWindow ?? builtinContextWindow(profile.model) ?? Number.MAX_SAFE_INTEGER;
    const settingsManager = sdk.SettingsManager.inMemory();
    const sessionManager = sdk.SessionManager.inMemory(cwd);
    const modelRuntime = await sdk.ModelRuntime.create({
      credentials: {
        read: async () => undefined,
        list: async () => [],
        modify: async (_provider, fn) => fn(undefined),
        delete: async () => {},
      },
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    modelRuntime.registerProvider("niceeval-managed", {
      baseUrl: profile.baseUrl,
      headers: { ...profile.headers },
      apiKey: input.apiKey,
      api: "openai-completions",
      models: [
        {
          id: profile.model,
          name: profile.model,
          api: "openai-completions",
          reasoning: false,
          input: profile.supportsImages ? ["text", "image"] : ["text"],
          contextWindow,
          maxTokens: profile.protocol.maxOutputTokens,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" },
        },
      ],
    });
    const model = modelRuntime.getModel("niceeval-managed", profile.model);
    if (model === undefined) throw new Error("Managed pi model is unavailable");
    const resourceLoader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir: "/niceeval-no-agent-resources",
      settingsManager,
      noExtensions: true,
      disabledBuiltinExtensions: ["mcp"],
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: input.systemPrompt,
    });
    await resourceLoader.reload();
    const customTools = input.customTools(sdk);
    const { session } = await sdk.createAgentSession({
      cwd,
      agentDir: "/niceeval-no-agent-resources",
      modelRuntime,
      model,
      scopedModels: [{ model }],
      settingsManager,
      sessionManager,
      resourceLoader,
      tools: [...new Set([...input.tools, ...customTools.map((tool) => tool.name)])],
      customTools,
    });
    return {
      session,
      sessionManager,
      prompt: (text: string, signal: AbortSignal) =>
        promptPiSession(session, text, signal, contextWindow, ai.isContextOverflow),
    };
  } catch (cause) {
    throw new PiFailure({
      kind: "session-init",
      message: cause instanceof Error ? cause.message : "pi session initialization failed",
      cause,
    });
  }
}

/** prompt() may return before pi's recovery loop finishes. The public settled
 * event closes the complete operation, including retries and auto compaction. */
async function promptPiSession(
  session: AgentSession,
  text: string,
  signal: AbortSignal,
  contextWindow: number,
  isContextOverflow: typeof import("@earendil-works/pi-ai")["isContextOverflow"],
): Promise<void> {
  let unsubscribe = () => {};
  let last: AssistantMessage | undefined;
  let failure: PiFailure | undefined;
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  try {
    unsubscribe = session.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "assistant") {
        last = event.message;
        failure ??= piUsageFailure(last.usage);
      }
      if (event.type === "compaction_end" && event.result === undefined && !event.willRetry && !signal.aborted)
        failure ??= new PiFailure({
          kind: "context-overflow",
          message: event.errorMessage ?? "pi could not compact the context",
          cause: event,
        });
      if (event.type === "agent_settled") settle();
    });
    if (signal.aborted)
      throw new PiFailure({ kind: "cancelled", message: "pi operation cancelled", cause: signal.reason });
    await session.prompt(text);
    await settled;
    if (signal.aborted)
      throw new PiFailure({ kind: "cancelled", message: "pi operation cancelled", cause: signal.reason });
    if (failure !== undefined) throw failure;
    if (last !== undefined) {
      if (isContextOverflow(last, contextWindow))
        throw new PiFailure({
          kind: "context-overflow",
          message: last.errorMessage ?? "pi context window exceeded",
          cause: last,
        });
      if (last.stopReason === "error" || last.stopReason === "aborted")
        throw new PiFailure({
          kind: "model-request",
          message: last.errorMessage ?? "pi model request failed",
          cause: last,
        });
    }
  } catch (cause) {
    if (signal.aborted)
      throw new PiFailure({ kind: "cancelled", message: "pi operation cancelled", cause: signal.reason ?? cause });
    throw piDefect(cause);
  } finally {
    unsubscribe();
  }
}
