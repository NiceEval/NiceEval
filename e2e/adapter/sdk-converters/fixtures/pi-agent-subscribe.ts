import { Effect } from "effect";
import { Agent, type AgentEvent, type AgentTool } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model,
  type StreamFunction,
} from "@earendil-works/pi-ai";
import { completeEvidenceCoverage, createPiAgentEventStream, defineAgent } from "niceeval/adapter";
import { Type } from "typebox";

const model = {
  id: "pi-agent-subscribe-fixture",
  name: "Pi Agent subscribe fixture",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "http://127.0.0.1.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8_192,
  maxTokens: 256,
} satisfies Model<"openai-responses">;

function usage(input: number, output: number) {
  return {
    input,
    output,
    cacheRead: 2,
    cacheWrite: 1,
    totalTokens: input + output + 3,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function assistant(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
  inputTokens: number,
  outputTokens: number,
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: usage(inputTokens, outputTokens),
    stopReason,
    ...(errorMessage === undefined ? {} : { errorMessage }),
    timestamp: 1_786_233_600_000,
  };
}

const streamFn: StreamFunction = (_model, context) => {
  const stream = createAssistantMessageEventStream();
  const terminalFailure = context.messages.some(
    (message) =>
      message.role === "user" &&
      (typeof message.content === "string"
        ? message.content.includes("terminal failure")
        : message.content.some((part) => part.type === "text" && part.text.includes("terminal failure"))),
  );
  const afterTool = context.messages.some((message) => message.role === "toolResult");

  queueMicrotask(() => {
    if (terminalFailure) {
      const failed = assistant([], "error", 5, 1, "pi-agent-terminal-failure-marker");
      stream.push({ type: "start", partial: failed });
      stream.push({ type: "error", reason: "error", error: failed });
      return;
    }

    if (!afterTool) {
      const toolMessage = assistant(
        [{ type: "toolCall", id: "pi-inventory-call", name: "inventory_lookup", arguments: { sku: "pi-001" } }],
        "toolUse",
        7,
        2,
      );
      stream.push({ type: "start", partial: toolMessage });
      stream.push({ type: "done", reason: "toolUse", message: toolMessage });
      return;
    }

    const partial = assistant([{ type: "text", text: "" }], "stop", 3, 3);
    const complete = assistant([{ type: "text", text: "pi-agent-subscribe-success-marker" }], "stop", 3, 3);
    stream.push({ type: "start", partial });
    stream.push({ type: "text_start", contentIndex: 0, partial });
    stream.push({ type: "text_delta", contentIndex: 0, delta: "pi-agent-subscribe-success-marker", partial: complete });
    stream.push({ type: "text_end", contentIndex: 0, content: "pi-agent-subscribe-success-marker", partial: complete });
    stream.push({ type: "done", reason: "stop", message: complete });
  });
  return stream;
};

const inventorySchema = Type.Object({ sku: Type.String() });

function hasSku(value: unknown): value is { sku: string } {
  return typeof value === "object" && value !== null && "sku" in value && typeof value.sku === "string";
}

const inventoryTool: AgentTool = {
  name: "inventory_lookup",
  label: "Inventory lookup",
  description: "Deterministic Pi Agent tool execution receipt",
  parameters: inventorySchema,
  async execute(toolCallId, params) {
    if (!hasSku(params)) {
      throw new Error("Pi Agent fixture expected a validated string sku");
    }
    const sku = params.sku;
    return {
      content: [{ type: "text", text: `inventory ${sku}` }],
      details: { toolCallId, sku, marker: "pi-agent-tool-result-marker" },
    };
  },
};

export const piAgentSubscribeFixtureAgent = defineAgent({
  name: "pi-agent-subscribe-deterministic-fixture",
  evidenceCoverage: completeEvidenceCoverage,
  send: (input, ctx) => Effect.tryPromise({
      try: async () => {
    const converter = createPiAgentEventStream();
    const events: ReturnType<typeof converter.add> = [];
    const agent = new Agent({
      streamFn,
      initialState: {
        systemPrompt: "Use the deterministic fixture tool when available.",
        model,
        thinkingLevel: "off",
        tools: [inventoryTool],
      },
      sessionId: input.text.includes("terminal failure") ? "pi-agent-failed-session" : "pi-agent-completed-session",
    });

    // This is the public boundary under test: the exact AgentEvent callback
    // object goes straight to NiceEval before prompt() starts and is unsubscribed
    // in finally. No fixture manufactures AgentEvent values.
    const unsubscribe = agent.subscribe((event: AgentEvent) => {
      events.push(...converter.add(event));
    });
    try {
      await agent.prompt(input.text);
      await agent.waitForIdle();
    } finally {
      unsubscribe();
    }

    ctx.session.capture(agent.sessionId);
    return {
      status: converter.failed ? "failed" : "completed",
      events,
      usage: converter.usage,
    };

      },
      catch: (cause) => cause,
    }),
});
