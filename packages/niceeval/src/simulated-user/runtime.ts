import {
  simulatedUserSystemPrompt,
  SIMULATED_USER_TOOL_DESCRIPTION,
  SIMULATED_USER_CORRECTION,
} from "./simulated-user.prompt.ts";
import type { AgentSession, SessionManager, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ResolvedJudgeConfig } from "../assertions/types.ts";
import { resolvePiCodingAgent } from "../judge/pi-dependency.ts";
import { managedPiCredential, piDefect, piUsageFailure, safePiFailureMessage, PiFailure } from "../judge/pi-failure.ts";
import { createManagedPiSession } from "../judge/pi-runtime.ts";
import { pricingEstimate } from "../o11y/cost.ts";
import type { PriceOverride } from "../types.ts";
import type { SimulatedUserConversation } from "./binding.ts";
import { simulatedUserToolSchema } from "./answers.ts";
import { SimulatedUserError, type SimulatedUserDefinition } from "./definition.ts";

type GenerationInput = Parameters<SimulatedUserConversation["generate"]>[0];
type AssistantMessage = Extract<AgentSession["messages"][number], { readonly role: "assistant" }>;
type PiUsage = AssistantMessage["usage"];

/** The coding-agent session owns requests, history, recovery and cancellation. */
export function createSimulatedUserConversation(
  definition: SimulatedUserDefinition,
  profile: ResolvedJudgeConfig | undefined,
  pricing: Record<string, PriceOverride> | undefined,
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
    const diagnostic = safePiFailureMessage(error, profile);
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
  const snapshot = () => JSON.stringify(sessionManager?.getEntries() ?? []);
  const abort = () => {
    void session?.abort().catch(() => undefined);
  };
  const record = (kind: "turn" | "compaction", usage: PiUsage | undefined) => {
    if (current === undefined) return;
    if (usage !== undefined) {
      const invalidUsage = piUsageFailure(usage);
      if (invalidUsage !== undefined) {
        failPi(invalidUsage);
        abort();
        return;
      }
    }
    const estimate =
      usage === undefined
        ? undefined
        : pricingEstimate(
            profile!.model,
            {
              inputTokens: usage.input,
              outputTokens: usage.output,
              cacheReadTokens: usage.cacheRead,
              cacheCreationTokens: usage.cacheWrite,
            },
            pricing,
          );
    current.generations.push({
      kind,
      inputTokens: usage === undefined ? null : usage.input + usage.cacheRead + usage.cacheWrite,
      outputTokens: usage?.output ?? null,
      costUSD:
        estimate?.state === "available" && estimate.receipt.priceSource.kind === "configured-override"
          ? estimate.receipt.amountUSD
          : null,
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
  const generate = async (input: GenerationInput) => {
    current = input;
    submitted = false;
    turns = 0;
    failure = undefined;
    invalid = false;
    if (profile === undefined)
      throw failPi(new PiFailure({ kind: "provider", message: "Judge Provider is not configured" }));
    if (profile.protocol.kind !== "chat-completions")
      throw new SimulatedUserError("simulated-user-unsupported-provider", "typesafe");
    if (closed) throw new SimulatedUserError("simulated-user-invalid-turn", "closed");
    input.signal.throwIfAborted();
    if (session === undefined) {
      let paths: ReturnType<typeof resolvePiCodingAgent>;
      try {
        paths = resolvePiCodingAgent();
      } catch (cause) {
        throw failPi(piDefect(cause));
      }
      let apiKey: string;
      try {
        apiKey = managedPiCredential(profile);
      } catch (cause) {
        throw failPi(piDefect(cause));
      }
      try {
        const managed = await createManagedPiSession({
          paths,
          profile,
          apiKey,
          tools: [],
          customTools: () => [tool()],
          systemPrompt: simulatedUserSystemPrompt(definition.instructions),
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
          record("turn", event.message.usage);
        }
        if (event.type === "compaction_start") compacting = true;
        if (event.type === "compaction_end") {
          compacting = false;
          if (event.result !== undefined) record("compaction", event.result.usage);
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
      running = generate(input).catch((cause: unknown) => {
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
