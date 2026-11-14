// @concord-file
// @concord-implements docs/feature/judge/architecture.md
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AssistantMessage, Model, ProviderStreams } from "@earendil-works/pi-ai";
import type { ResolvedJudgeConfig } from "../assertions/types.ts";

/** One physical request, shared by ordinary turns and pi compaction summaries.
 * Policies own admission, audit and usage; pi owns payloads, HTTP and history. */
export interface PiRequestPolicy {
  start(): void;
  payload(payload: unknown, signal: AbortSignal): unknown;
  status(status: number): void;
  /** False aborts the physical request before retaining more response data. */
  delta(bytes: number): boolean;
  complete(message: AssistantMessage, signal: AbortSignal, overflow: boolean): AssistantMessage | undefined;
  error(error: unknown): void;
  failure(): string;
}

/** Builds exactly one managed provider without registry or environment fallback.
 * The returned harness factory accepts the caller's system prompt, tools and
 * session. The caller supplies independent audit/usage/admission policies. */
export async function createManagedPiRuntime(input: {
  readonly paths: { readonly core: string; readonly ai: string };
  readonly profile: ResolvedJudgeConfig;
  readonly apiKey: string;
  readonly signal: AbortSignal;
  readonly deadline: () => number;
  readonly request: (model: Model<"openai-completions">) => PiRequestPolicy;
}) {
  const [core, pi, completions] = await Promise.all([
    import(pathToFileURL(input.paths.core).href) as Promise<typeof import("@earendil-works/pi-agent-core")>,
    import(pathToFileURL(input.paths.ai).href) as Promise<typeof import("@earendil-works/pi-ai")>,
    import(pathToFileURL(join(dirname(input.paths.ai), "api/openai-completions.js")).href) as Promise<typeof import("@earendil-works/pi-ai/api/openai-completions")>,
  ]);
  const profile = input.profile;
  if (profile.protocol.kind !== "chat-completions") throw new TypeError("pi requires a chat-completions provider");
  const model: Model<"openai-completions"> = { id: profile.model, name: profile.model, api: "openai-completions", provider: "niceeval-managed", baseUrl: profile.baseUrl,
    reasoning: false, input: profile.supportsImages ? ["text", "image"] : ["text"],
    // Unknown: explicit provider overflow is the only context limit authority.
    contextWindow: 0, maxTokens: profile.protocol.maxOutputTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" } };
  const models = pi.createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
  const stream: ProviderStreams["streamSimple"] = (selected, context, options) => {
    const chosen = selected as Model<"openai-completions">;
    const output = pi.createAssistantMessageEventStream();
    const policy = input.request(chosen);
    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal.addEventListener("abort", abort, { once: true });
    options?.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal.aborted || options?.signal?.aborted) abort();
    const timeoutMs = Math.max(1, Math.min(profile.timeoutMs, input.deadline() - Date.now()));
    const timer = setTimeout(abort, timeoutMs);
    const fallback = (): AssistantMessage => ({ role: "assistant", api: chosen.api, provider: chosen.provider, model: chosen.id, content: [], timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: input.signal.aborted ? "aborted" : "error", errorMessage: policy.failure() });
    const finish = (message: AssistantMessage) => {
      if (message.stopReason === "error" || message.stopReason === "aborted") output.push({ type: "error", reason: message.stopReason, error: message });
      else output.push({ type: "done", reason: message.stopReason, message });
      output.end(message);
    };
    void (async () => {
      try {
        policy.start();
        const upstream = completions.streamSimple(chosen, context, { ...options, signal: controller.signal, timeoutMs, maxRetries: 0, env: {}, cacheRetention: "none",
          maxTokens: Math.min(options?.maxTokens ?? chosen.maxTokens, chosen.maxTokens),
          onPayload: payload => {
            if (controller.signal.aborted) throw new Error("pi request cancelled before sending");
            return policy.payload(payload, controller.signal);
          },
          onResponse: response => { policy.status(response.status); },
        });
        let bytes = 0;
        for await (const event of upstream) {
          if (event.type === "text_delta" || event.type === "thinking_delta" || event.type === "toolcall_delta") bytes += Buffer.byteLength(event.delta);
          if (!policy.delta(bytes)) abort();
          if (event.type !== "done" && event.type !== "error" && !controller.signal.aborted) output.push(event);
        }
        const message = await upstream.result();
        finish(policy.complete(message, controller.signal, pi.isContextOverflow(message)) ?? fallback());
      } catch (error) { policy.error(error); finish(fallback()); }
      finally {
        clearTimeout(timer);
        input.signal.removeEventListener("abort", abort);
        options?.signal?.removeEventListener("abort", abort);
      }
    })();
    return output;
  };
  models.setProvider(pi.createProvider({ id: model.provider, baseUrl: profile.baseUrl, headers: profile.headers, models: [model],
    auth: { apiKey: { name: "Managed credential", resolve: async () => ({ auth: { apiKey: input.apiKey } }) } }, api: { stream, streamSimple: stream } }));
  return { core, pi, model, models };
}

/** Explicit overflow gets one default pi compaction and one replay. Summary
 * requests use the same provider middleware and do not consume caller turns. */
export async function promptPiWithCompaction(
  agent: import("@earendil-works/pi-agent-core").AgentHarness,
  prompt: string,
  options: {
    readonly overflow: (message: AssistantMessage) => boolean;
    readonly active: () => boolean;
    readonly start: () => void;
    readonly end: () => void;
    readonly failed: (error: unknown) => void;
    readonly stillOverflow: () => void;
  },
): Promise<AssistantMessage> {
  let response = await agent.prompt(prompt);
  if (!options.overflow(response) || !options.active()) return response;
  options.start();
  try { await agent.compact(); }
  catch (error) { options.failed(error); }
  finally { options.end(); }
  if (options.active()) {
    response = await agent.prompt(prompt);
    if (options.overflow(response)) options.stillOverflow();
  }
  return response;
}
