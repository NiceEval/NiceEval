import type { RememberAttemptCredentials } from "../context/attempt-sensitive-values.ts";
import {
  activeEvidenceRedactor,
  mapEvidenceText,
  redactJsonEvidence,
  type RedactEvidenceText,
} from "../sandbox/redaction.ts";
import { JudgeTimingSpan } from "../judge/timing.ts";
import {
  simulatedUserSystemPrompt,
  SIMULATED_USER_TOOL_DESCRIPTION,
  SIMULATED_USER_CORRECTION,
} from "./simulated-user.prompt.ts";
import type { AgentSession, SessionManager, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ResolvedJudgeConfig } from "../assertions/types.ts";
import { resolvePiCodingAgent } from "../judge/pi-dependency.ts";
import {
  managedPiCredential,
  piDefect,
  piUsageFailure,
  redactPiSessionEntries,
  safePiFailureMessage,
  PiFailure,
} from "../judge/pi-failure.ts";
import { createManagedPiSession, type PiUsageReceipt } from "../judge/pi-runtime.ts";
import { configuredProfile } from "../o11y/adapter-call-price.ts";
import { builtinCallPrice } from "../o11y/builtin-call-price.ts";
import { estimateCallPrice } from "../o11y/judge-call-price.ts";
import { normalizeJudgeUsageResponse } from "../o11y/judge-usage-receipt.ts";
import type { PriceOverride } from "../types.ts";
import type { SimulatedUserConversation } from "./binding.ts";
import { simulatedUserToolSchema } from "./answers.ts";
import { SimulatedUserError, type SimulatedUserDefinition } from "./definition.ts";

type GenerationInput = Parameters<SimulatedUserConversation["generate"]>[0];
type AssistantMessage = Extract<AgentSession["messages"][number], { readonly role: "assistant" }>;
type PiUsage = AssistantMessage["usage"];
type UsageTokens = Parameters<typeof estimateCallPrice>[0];

/** The coding-agent session owns requests, history, recovery and cancellation. */
export function createSimulatedUserConversation(
  definition: SimulatedUserDefinition,
  profile: ResolvedJudgeConfig | undefined,
  pricing: Record<string, PriceOverride> | undefined,
  timing?: import("../runner/timing.ts").TimingRecorder,
  promptCache?: import("../judge/prompt-cache.ts").JudgePromptCache,
  redact?: RedactEvidenceText,
  remember?: RememberAttemptCredentials,
): SimulatedUserConversation {
  let session: AgentSession | undefined;
  let prompt: Awaited<ReturnType<typeof createManagedPiSession>>["prompt"] | undefined;
  let sessionManager: SessionManager | undefined;
  let current: GenerationInput | undefined;
  let closed = false;
  let submitted = false;
  let compacting = false;
  let turns = 0;
  let failure: SimulatedUserError | undefined;
  let invalid = false;
  let running: Promise<void> | undefined;
  let unsubscribe: (() => void) | undefined;
  let closing: Promise<void> | undefined;
  const fail = (reason: string, cause?: unknown, diagnostic?: string) =>
    (failure ??= new SimulatedUserError("simulated-user-failed", reason, cause, diagnostic));
  const failPi = (error: PiFailure): SimulatedUserError => {
    const diagnostic = safePiFailureMessage(error, profile, redact);
    switch (error.kind) {
      case "dependency":
        return fail("pi-unavailable", error.cause ?? error, diagnostic);
      case "provider":
      case "credential":
        return fail("provider-unconfigured", error.cause ?? error, diagnostic);
      case "session-init":
        return fail("session-failed", error.cause ?? error, diagnostic);
      case "model-request":
        return fail("transport", error.cause ?? error, diagnostic);
      case "context-overflow":
        return fail("context-overflow", error.cause ?? error, diagnostic);
      case "cancelled":
        return fail("timeout", error.cause ?? error, diagnostic);
      case "defect":
        return fail("defect", error.cause ?? error, diagnostic);
      default: {
        const exhaustive: never = error.kind;
        return exhaustive;
      }
    }
  };
  const active = () => !closed && !submitted && !current?.signal.aborted && failure === undefined;
  const snapshot = () => {
    const entries = sessionManager?.getEntries() ?? [];
    const active = activeEvidenceRedactor(redact);
    const projected =
      active === undefined ? entries : mapEvidenceText(entries, (value) => redactJsonEvidence(value, active));
    return JSON.stringify(redactPiSessionEntries(projected, profile));
  };
  const abort = () => {
    void session?.abort().catch(() => undefined);
  };
  const record = (
    kind: "turn" | "compaction",
    usage: PiUsage | undefined,
    receipts: readonly PiUsageReceipt[] = [],
  ) => {
    if (current === undefined || profile === undefined) return;
    if (usage !== undefined) {
      const invalidUsage = piUsageFailure(usage);
      if (invalidUsage !== undefined) {
        failPi(invalidUsage);
        abort();
        return;
      }
    }
    const parsed = receipts.map(({ body }) => normalizeJudgeUsageResponse(profile.provider, body));
    const selected = configuredProfile(profile.model, pricing) ?? builtinCallPrice(profile.model);
    function price(reported: (typeof parsed)[number]["cost"] | undefined, tokens: UsageTokens) {
      if (reported?.currency === "USD") {
        const costUSD = Number(reported.amount);
        if (Number.isFinite(costUSD)) return { costUSD, priceSource: reported.source };
      }
      if (selected !== undefined) {
        const rates = selected.ratesPerMTok;
        const estimate = estimateCallPrice(tokens, {
          ratesPerMTok:
            selected.source.kind === "configured-profile"
              ? { ...rates, cacheRead: rates.cacheRead ?? rates.input, cacheWrite: rates.cacheWrite ?? rates.input }
              : rates,
        });
        const costUSD = Number(estimate.amount);
        if (estimate.missing.length === 0 && Number.isFinite(costUSD))
          return { costUSD, priceSource: { ...selected.source, selector: selected.selector } };
      }
      return { costUSD: null };
    }
    if (parsed.length > 1) {
      for (const receipt of parsed) {
        current.generations.push({
          kind,
          inputTokens: receipt.inputTotalTokens,
          outputTokens: receipt.outputTokens,
          ...price(receipt.cost, receipt),
        });
      }
      return;
    }
    const raw = parsed[0];
    const measuredUsage =
      usage?.totalTokens === 0 && raw?.inputTotalTokens == null && raw?.outputTokens == null ? undefined : usage;
    const tokens = {
      inputTokens: measuredUsage?.input ?? null,
      outputTokens: measuredUsage?.output ?? null,
      cacheReadTokens: measuredUsage?.cacheRead ?? null,
      cacheWriteTokens: measuredUsage?.cacheWrite ?? null,
    };
    current.generations.push({
      kind,
      inputTokens:
        measuredUsage === undefined ? null : measuredUsage.input + measuredUsage.cacheRead + measuredUsage.cacheWrite,
      outputTokens: tokens.outputTokens,
      ...price(raw?.cost, tokens),
    });
  };
  const tool = (): ToolDefinition => ({
    name: "reply_to_agent",
    label: "Reply to Agent",
    description: SIMULATED_USER_TOOL_DESCRIPTION,
    executionMode: "sequential",
    parameters: simulatedUserToolSchema(current!.requests) as ToolDefinition["parameters"],
    async execute(_id, args) {
      if (!active()) throw new Error("Simulated user answer is closed");
      try {
        current!.submit(args);
      } catch (error) {
        invalid = true;
        throw error;
      }
      submitted = true;
      return { content: [{ type: "text", text: "Answer accepted." }], details: {} };
    },
  });
  const generateAnswer = async (input: GenerationInput) => {
    current = input;
    submitted = false;
    turns = 0;
    failure = undefined;
    invalid = false;
    if (profile === undefined)
      throw failPi(
        new PiFailure({
          kind: "provider",
          message: "Judge Provider is not configured",
          cause: undefined,
        }),
      );
    if (profile.protocol.kind !== "chat-completions")
      throw new SimulatedUserError("simulated-user-unsupported-provider", "typesafe");
    if (closed) throw new SimulatedUserError("simulated-user-invalid-turn", "closed");
    input.signal.throwIfAborted();
    if (session === undefined) {
      let managed: Awaited<ReturnType<typeof createManagedPiSession>>;
      let paths: ReturnType<typeof resolvePiCodingAgent>;
      try {
        paths = resolvePiCodingAgent();
      } catch (cause) {
        throw failPi(piDefect(cause));
      }
      let apiKey: string;
      try {
        apiKey = managedPiCredential(profile, remember);
      } catch (cause) {
        throw failPi(piDefect(cause));
      }
      try {
        managed = await createManagedPiSession({
          paths,
          profile,
          apiKey,
          promptCache,
          tools: [],
          customTools: () => [tool()],
          systemPrompt: simulatedUserSystemPrompt(definition.instructions),
          cwd: "/",
        });
        session = managed.session;
        sessionManager = managed.sessionManager;
        prompt = managed.prompt;
      } catch (cause) {
        throw failPi(piDefect(cause));
      }
      input.signal.throwIfAborted();
      const originalPayload = session.agent.onPayload;
      session.agent.onPayload = async (payload, model) => {
        if (!active()) {
          abort();
          throw failure ?? new Error("Simulated user generation is closed");
        }
        if (!compacting && turns >= 4) {
          abort();
          throw fail(invalid ? "invalid-answer" : "no-answer");
        }
        if (!compacting) turns++;
        return originalPayload?.(payload, model) ?? payload;
      };
      const beforeToolCall = session.agent.beforeToolCall;
      session.agent.beforeToolCall = async (context, signal) =>
        active()
          ? beforeToolCall?.(context, signal)
          : { block: true, reason: "Answer already submitted", terminate: true };
      const afterToolCall = session.agent.afterToolCall;
      session.agent.afterToolCall = async (context, signal) => {
        const result = await afterToolCall?.(context, signal);
        if (context.isError) invalid = true;
        return submitted ? { ...result, terminate: true } : result;
      };
      unsubscribe = session.subscribe((event) => {
        if (event.type === "tool_execution_end" && event.toolName === "reply_to_agent" && event.isError) invalid = true;
        if (event.type === "message_end" && event.message.role === "assistant") {
          record("turn", event.message.usage, managed.readUsageReceipts(event.message.usage));
        }
        if (event.type === "compaction_start") {
          compacting = true;
          managed.startCompaction();
        }
        if (event.type === "compaction_end") {
          compacting = false;
          const usage = event.result?.usage;
          managed.finishCompaction(usage);
          if (event.result !== undefined)
            record("compaction", usage, usage === undefined ? undefined : managed.readUsageReceipts(usage));
        }
      });
    } else {
      const definition = session.getToolDefinition("reply_to_agent");
      if (definition === undefined) throw failPi(piDefect(new Error("pi reply_to_agent tool disappeared")));
      // pi's registered wrapper retains this schema object. Mutate its contents
      // so the next request and tool validation see this Turn's exact schema.
      for (const key of Object.keys(definition.parameters)) Reflect.deleteProperty(definition.parameters, key);
      Object.assign(definition.parameters, simulatedUserToolSchema(input.requests));
    }
    session.setActiveToolsByName(["reply_to_agent"]);
    input.signal.addEventListener("abort", abort, { once: true });
    if (input.signal.aborted) abort();
    try {
      do {
        try {
          await prompt!(turns === 0 ? input.question : SIMULATED_USER_CORRECTION, input.signal);
        } catch (cause) {
          if (input.signal.aborted) input.signal.throwIfAborted();
          if (failure === undefined) throw failPi(piDefect(cause));
        }
      } while (active() && turns < 4);
      if (failure !== undefined) throw failure;
      if (!submitted) throw fail(invalid ? "invalid-answer" : "no-answer");
    } finally {
      input.signal.removeEventListener("abort", abort);
    }
  };
  return {
    generate(input) {
      const span = JudgeTimingSpan.start(timing, "simulated-user.reply");
      running = generateAnswer(input)
        .then(() => {
          span?.end();
        })
        .catch((cause: unknown) => {
          span?.end(input.signal.aborted ? "cancelled" : "failed");
          if (cause instanceof SimulatedUserError || input.signal.aborted) throw cause;
          throw failPi(piDefect(cause));
        });
      return running;
    },
    async snapshot() {
      return snapshot();
    },
    close() {
      if (closing !== undefined) return closing;
      closed = true;
      closing = (async () => {
        const failures: unknown[] = [];
        // On successful abort, settle the generation before releasing listeners.
        // If abort rejects, dispose immediately: waiting first could retain a
        // generation which pi failed to stop. Every release failure is retained.
        try {
          await session?.abort();
          await running?.catch(() => undefined);
        } catch (error) {
          failures.push(error);
        } finally {
          try {
            unsubscribe?.();
          } catch (error) {
            failures.push(error);
          }
          try {
            session?.dispose();
          } catch (error) {
            failures.push(error);
          }
        }
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) throw new AggregateError(failures, "Simulated user pi session failed during release");
      })();
      return closing;
    },
  };
}
