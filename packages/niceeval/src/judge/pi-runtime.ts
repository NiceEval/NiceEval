// @concord-file
// @concord-implements docs/feature/judge/architecture.md
import { judgeTimingFetch, type JudgeTimingSpan } from "./timing.ts";
import { retryAfterMs } from "../assertions/judge-transport.ts";
import { builtinContextWindow } from "../o11y/builtin-models.ts";
import { pathToFileURL } from "node:url";
import type { ResolvedJudgeConfig } from "../assertions/types.ts";
import type { AgentSession, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { PiFailure, piDefect, piUsageFailure } from "./pi-failure.ts";
import { normalizeExternalCause } from "../shared/external-cause.ts";
import type { AssistantMessage } from "@earendil-works/pi-ai";
type CodingSdk = typeof import("@earendil-works/pi-coding-agent");

/** Creates an isolated coding-agent session. pi owns requests, tools, retries,
 * compaction and usage. No user files, resources or credentials are discovered. */
export async function createManagedPiSession(input: {
  readonly paths: { readonly coding: string; readonly ai: string };
  readonly profile: ResolvedJudgeConfig;
  readonly apiKey: string;
  readonly systemPrompt: string;
  readonly cwd: string;
  readonly tools: readonly string[];
  readonly timing?: (() => JudgeTimingSpan | undefined) | undefined;
  readonly customTools: (sdk: CodingSdk) => ToolDefinition[];
}) {
  let sdk: CodingSdk;
  let ai: typeof import("@earendil-works/pi-ai");
  try {
    sdk = (await import(pathToFileURL(input.paths.coding).href)) as CodingSdk;
    ai = (await import(pathToFileURL(input.paths.ai).href)) as typeof ai;
  } catch (cause) {
    throw new PiFailure({
      kind: "dependency",
      message: "pi dependency could not be loaded",
      cause: normalizeExternalCause(cause),
    });
  }
  try {
    const profile = input.profile;
    if (profile.protocol.kind !== "chat-completions") throw new TypeError("pi requires a chat-completions provider");
    const cwd = input.cwd;
    const contextWindow = profile.contextWindow ?? builtinContextWindow(profile.model) ?? Number.MAX_SAFE_INTEGER;
    // The public session retry API classifies error text. Provider retries use
    // HTTP status/headers and share the request AbortSignal, including backoff.
    const settingsManager = sdk.SettingsManager.inMemory({
      retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 2, maxRetryDelayMs: 60_000 } },
    });
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
    let httpOrdinal = 0;
    let lastHttp: { readonly status: number | null; readonly retryAfterMs: number | null } | undefined;
    const transport = input.timing === undefined ? globalThis.fetch : judgeTimingFetch(input.timing);
    const fetch: typeof globalThis.fetch = async (request, options) => {
      const ordinal = ++httpOrdinal;
      lastHttp = undefined;
      let status: number | null = null;
      let delay: number | null = null;
      try {
        const response = await transport(request, options);
        status = response.status;
        const milliseconds = response.headers.get("retry-after-ms");
        const parsed = milliseconds === null ? undefined : Number(milliseconds);
        delay =
          parsed !== undefined && Number.isFinite(parsed) && parsed >= 0
            ? parsed
            : (retryAfterMs(response.headers, Date.now()) ?? null);
        return response;
      } finally {
        lastHttp = { status, retryAfterMs: delay };
        // Custom entries are retained by pi but never become model messages.
        sessionManager.appendCustomEntry("niceeval.http", { ordinal, ...lastHttp });
      }
    };
    const streamSimple = modelRuntime.streamSimple.bind(modelRuntime);
    modelRuntime.streamSimple = (model, context, options) => streamSimple(model, context, { ...options, fetch });
    const httpDiagnostic = () =>
      lastHttp === undefined
        ? ""
        : `HTTP ${lastHttp.status ?? "status unknown"}${lastHttp.retryAfterMs === null ? "" : `; Retry-After ${lastHttp.retryAfterMs} ms`}: `;
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
      prompt: async (text: string, signal: AbortSignal) => {
        lastHttp = undefined;
        try {
          await promptPiSession(session, text, signal, contextWindow, ai.isContextOverflow);
        } catch (error) {
          if (error instanceof PiFailure && error.kind === "model-request")
            throw new PiFailure({ ...error, message: httpDiagnostic() + error.message });
          throw error;
        }
      },
    };
  } catch (cause) {
    throw new PiFailure({
      kind: "session-init",
      message: cause instanceof Error ? cause.message : "pi session initialization failed",
      cause: normalizeExternalCause(cause),
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
          cause: normalizeExternalCause(event),
        });
      if (event.type === "agent_settled") settle();
    });
    if (signal.aborted)
      throw new PiFailure({
        kind: "cancelled",
        message: "pi operation cancelled",
        cause: normalizeExternalCause(signal.reason),
      });
    await session.prompt(text);
    await settled;
    if (signal.aborted)
      throw new PiFailure({
        kind: "cancelled",
        message: "pi operation cancelled",
        cause: normalizeExternalCause(signal.reason),
      });
    if (failure !== undefined) throw failure;
    if (last !== undefined) {
      if (isContextOverflow(last, contextWindow))
        throw new PiFailure({
          kind: "context-overflow",
          message: last.errorMessage ?? "pi context window exceeded",
          cause: normalizeExternalCause(last),
        });
      if (last.stopReason === "error" || last.stopReason === "aborted")
        throw new PiFailure({
          kind: "model-request",
          message: last.errorMessage ?? "pi model request failed",
          cause: normalizeExternalCause(last),
        });
    }
  } catch (cause) {
    if (signal.aborted)
      throw new PiFailure({
        kind: "cancelled",
        message: "pi operation cancelled",
        cause: normalizeExternalCause(signal.reason ?? cause),
      });
    throw piDefect(cause);
  } finally {
    unsubscribe();
  }
}
