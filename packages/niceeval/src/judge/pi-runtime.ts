// @concord-file
// @concord-implements docs/feature/judge/architecture.md
import { judgeRequestTiming, type JudgeTimingOutcome, type JudgeTimingSpan } from "./timing.ts";
import { readJudgeResponseText, retryAfterMs } from "../assertions/judge-transport.ts";
import { builtinContextWindow } from "../o11y/builtin-models.ts";
import { pathToFileURL } from "node:url";
import type { ResolvedJudgeConfig } from "../assertions/types.ts";
import type { AgentSession, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { PiFailure, piDefect, piUsageFailure } from "./pi-failure.ts";
import { normalizeExternalCause } from "../shared/external-cause.ts";
import * as Predicate from "effect/Predicate";
import type { JudgePromptCache } from "./prompt-cache.ts";
import type { AssistantMessage, AssistantMessageEvent, Usage } from "@earendil-works/pi-ai";
type CodingSdk = typeof import("@earendil-works/pi-coding-agent");
type ProviderRetry = typeof import("@earendil-works/pi-ai/utils/provider-retry").retryProviderRequest;
export type PiUsageReceipt = { readonly httpStatus: number | undefined; readonly body: string };
type StreamFailure = Extract<AssistantMessageEvent, { type: "error" }>;

/** Creates an isolated coding-agent session. pi owns requests, tools, retries,
 * compaction and usage. No user files, resources or credentials are discovered. */
export async function createManagedPiSession(input: {
  readonly paths: { readonly coding: string; readonly ai: string };
  readonly profile: ResolvedJudgeConfig;
  readonly apiKey: string;
  readonly promptCache?: JudgePromptCache | undefined;
  readonly systemPrompt: string;
  readonly cwd: string;
  readonly tools: readonly string[];
  readonly timing?: (() => JudgeTimingSpan | undefined) | undefined;
  readonly customTools: (sdk: CodingSdk) => ToolDefinition[];
}) {
  let sdk: CodingSdk;
  let ai: typeof import("@earendil-works/pi-ai");
  let retryProviderRequest: ProviderRetry;
  try {
    const aiUrl = pathToFileURL(input.paths.ai);
    sdk = (await import(pathToFileURL(input.paths.coding).href)) as CodingSdk;
    ai = (await import(aiUrl.href)) as typeof ai;
    // Resolve pi-ai's exported utils/provider-retry from the same installation as the SDK.
    ({ retryProviderRequest } = (await import(new URL("./utils/provider-retry.js", aiUrl).href)) as {
      retryProviderRequest: ProviderRetry;
    });
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
    // The public session retry API classifies error text. Keep retries at the
    // provider boundary, where HTTP metadata and decoded output events are available.
    const providerRetry = { maxRetries: 2, maxRetryDelayMs: 60_000 };
    const settingsManager = sdk.SettingsManager.inMemory({
      retry: { enabled: false, maxRetries: 0, provider: providerRetry },
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
    const fetch: typeof globalThis.fetch = async (request, options) => {
      const ordinal = ++httpOrdinal;
      lastHttp = undefined;
      let status: number | null = null;
      let delay: number | null = null;
      try {
        const response = await globalThis.fetch(request, options);
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
    const usageReceipts = new WeakMap<Usage, readonly PiUsageReceipt[]>();
    let compactionReceipts: PiUsageReceipt[] | undefined;
    const streamSimple = modelRuntime.streamSimple.bind(modelRuntime);
    const startRequest = input.timing === undefined ? undefined : judgeRequestTiming(input.timing);
    modelRuntime.streamSimple = (model, context, options) =>
      ai.lazyStream(
        model,
        async () => {
          let lastFailure: StreamFailure | undefined;
          try {
            return await retryProviderRequest(
              async () => {
                lastFailure = undefined;
                let http: { readonly status: number | undefined; readonly headers: Headers | undefined } | undefined;
                let timing: JudgeTimingSpan | undefined;
                let cacheKeyRejected = false;
                let usageBody = "";
                const sessionId = input.promptCache?.activeKey;
                let sentCacheKey = sessionId;
                const stream = streamSimple(model, context, {
                  ...options,
                  ...(input.promptCache === undefined
                    ? {}
                    : sessionId === undefined
                      ? { cacheRetention: "none" }
                      : { sessionId, cacheRetention: "short" }),
                  maxRetries: 0,
                  onPayload: async (payload, requestModel) => {
                    const transformed = (await options?.onPayload?.(payload, requestModel)) ?? payload;
                    // Another review may have received the 400 while this payload was being assembled.
                    if (
                      sentCacheKey !== undefined &&
                      input.promptCache?.activeKey === undefined &&
                      Predicate.isObject(transformed)
                    ) {
                      sentCacheKey = undefined;
                      const { prompt_cache_key: _omitted, ...rest } = transformed;
                      return rest;
                    }
                    return transformed;
                  },
                  onProviderStreamEvent: async (event, requestModel) => {
                    if (Predicate.isObject(event)) {
                      const choice = Array.isArray(event.choices) ? event.choices[0] : undefined;
                      const reported = event.usage ?? (Predicate.isObject(choice) ? choice.usage : undefined);
                      if (reported != null) {
                        usageBody = JSON.stringify({ model: event.model, provider: event.provider, usage: reported });
                      }
                    }
                    await options?.onProviderStreamEvent?.(event, requestModel);
                  },
                  fetch: async (request, init) => {
                    timing = startRequest?.();
                    http = { status: undefined, headers: undefined };
                    const response = await fetch(request, init);
                    http = { status: response.status, headers: response.headers };
                    if (sentCacheKey !== undefined && response.status === 400) {
                      const body = await readJudgeResponseText(
                        response.clone(),
                        profile.maxResponseBytes,
                        options?.signal,
                      ).catch(() => "");
                      cacheKeyRejected =
                        input.promptCache?.observeRejection(sentCacheKey, response.status, body) === true;
                    }
                    return response;
                  },
                });
                const failureOutcome = () => (options?.signal?.aborted ? "cancelled" : "failed");
                const finish = (outcome: JudgeTimingOutcome) => timing?.end(outcome);
                // A response's terminal event distinguishes a broken stream from [DONE].
                void stream.result().then(
                  ({ stopReason, usage }) => {
                    const receipt = { httpStatus: http?.status, body: usageBody };
                    usageReceipts.set(usage, [receipt]);
                    if (stopReason !== "error" && stopReason !== "aborted") compactionReceipts?.push(receipt);
                    finish(stopReason === "aborted" ? "cancelled" : stopReason === "error" ? "failed" : "completed");
                  },
                  () => finish(failureOutcome()),
                );
                const events = stream[Symbol.asyncIterator]();
                const first = await events.next();
                // "start" only acknowledges headers. The next event is either
                // model output or the terminal result. Only that prefix is held back.
                const started = !first.done && first.value.type === "start";
                const next = started ? await events.next() : first;
                if (!next.done && next.value.type === "error" && next.value.reason === "error" && http !== undefined) {
                  lastFailure = next.value;
                  await events.return?.();
                  const headers = new Headers(http.headers);
                  if (cacheKeyRejected) {
                    headers.set("x-should-retry", "true");
                    headers.set("retry-after-ms", "0");
                  } else if (http.status === 200 && headers.get("x-should-retry") !== "false") {
                    headers.set("x-should-retry", "true");
                  }
                  throw Object.assign(new Error(next.value.error.errorMessage ?? "pi model request failed"), {
                    status: http.status,
                    headers,
                  });
                }
                return {
                  async *[Symbol.asyncIterator]() {
                    if (started && !first.done) yield first.value;
                    if (!next.done) yield next.value;
                    yield* { [Symbol.asyncIterator]: () => events };
                  },
                };
              },
              { ...providerRetry, ...(options?.signal === undefined ? {} : { signal: options.signal }) },
            );
          } catch (cause) {
            if (lastFailure === undefined) throw cause;
            const reason = options?.signal?.aborted ? "aborted" : "error";
            const terminal: StreamFailure = {
              type: "error",
              reason,
              error: {
                ...lastFailure.error,
                stopReason: reason,
                errorMessage:
                  cause instanceof Error
                    ? cause.message
                    : (lastFailure.error.errorMessage ?? "pi model request failed"),
              },
            };
            return {
              async *[Symbol.asyncIterator]() {
                yield terminal;
              },
            };
          }
        },
        undefined,
        options?.signal,
      );
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
          compat: {
            supportsStore: false,
            supportsDeveloperRole: false,
            maxTokensField: "max_tokens",
            ...(input.promptCache === undefined
              ? {}
              : { promptCacheKeyMode: "enabled", sendSessionAffinityHeaders: false }),
          },
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
      readUsageReceipts: (usage: Usage) => usageReceipts.get(usage),
      startCompaction: () => {
        compactionReceipts = [];
      },
      finishCompaction: (usage: Usage | undefined) => {
        if (usage !== undefined && compactionReceipts?.length) usageReceipts.set(usage, compactionReceipts);
        compactionReceipts = undefined;
      },
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
