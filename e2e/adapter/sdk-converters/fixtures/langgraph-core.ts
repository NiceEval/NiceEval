import { Effect } from "effect";
import { StateGraph, START, END } from "@langchain/langgraph";
import type { Event } from "@langchain/protocol";
import { completeEvidenceCoverage, createLangGraphEventStream, defineAgent } from "niceeval/adapter";
import { z } from "zod";

const CoreState = z.object({ value: z.string() });
const coreGraph = new StateGraph(CoreState)
  .addNode("core_node", (state) => ({ value: `${state.value}:runtime-complete` }))
  .addEdge(START, "core_node")
  .addEdge("core_node", END)
  .compile({ name: "sdk-converters-langgraph-core" });

const timestamp = 1_786_233_600_000;

function officialCoreFrames(runtimeMethods: readonly string[]): Event[] {
  const receipt = `langgraph-runtime-methods:${[...new Set(runtimeMethods)].join(",")}`;
  return [
    {
      type: "event",
      seq: 1,
      method: "lifecycle",
      params: { namespace: [], timestamp, data: { event: "started", graph_name: "sdk-converters-langgraph-core" } },
    },
    {
      type: "event",
      seq: 2,
      method: "values",
      params: {
        namespace: ["ignored-state:checkpoint"],
        timestamp,
        data: { ignored: true },
      },
    },
    {
      type: "event",
      seq: 3,
      method: "messages",
      params: {
        namespace: [],
        timestamp,
        node: "core_node",
        data: { event: "message-start", role: "ai", id: "langgraph-core-message" },
      },
    },
    {
      type: "event",
      seq: 4,
      method: "messages",
      params: {
        namespace: [],
        timestamp,
        node: "core_node",
        data: { event: "content-block-start", index: 0, content: { type: "text", text: "" } },
      },
    },
    {
      type: "event",
      seq: 5,
      method: "messages",
      params: {
        namespace: [],
        timestamp,
        node: "core_node",
        data: { event: "content-block-delta", index: 0, delta: { type: "text-delta", text: receipt } },
      },
    },
    {
      type: "event",
      seq: 6,
      method: "messages",
      params: {
        namespace: [],
        timestamp,
        node: "core_node",
        data: { event: "content-block-finish", index: 0, content: { type: "text", text: receipt } },
      },
    },
    {
      type: "event",
      seq: 7,
      method: "messages",
      params: {
        namespace: [],
        timestamp,
        node: "core_node",
        data: {
          event: "content-block-finish",
          index: 1,
          content: {
            type: "tool_call",
            id: "langgraph-core-tool-call",
            name: "graph_lookup",
            args: { query: "fixture" },
          },
        },
      },
    },
    {
      type: "event",
      seq: 8,
      method: "messages",
      params: {
        namespace: [],
        timestamp,
        node: "core_node",
        data: {
          event: "message-finish",
          usage: {
            input_tokens: 13,
            output_tokens: 7,
            input_token_details: { cache_read: 3, cache_creation: 2 },
            output_token_details: { reasoning: 1 },
          },
        },
      },
    },
    {
      type: "event",
      seq: 9,
      method: "tools",
      params: {
        namespace: [],
        timestamp,
        node: "core_node",
        data: {
          event: "tool-started",
          tool_call_id: "langgraph-core-tool-call",
          tool_name: "graph_lookup",
          input: { query: "fixture" },
        },
      },
    },
    {
      type: "event",
      seq: 10,
      method: "tools",
      params: {
        namespace: [],
        timestamp,
        node: "core_node",
        data: {
          event: "tool-finished",
          tool_call_id: "langgraph-core-tool-call",
          output: { marker: "langgraph-core-tool-output" },
        },
      },
    },
    {
      type: "event",
      seq: 11,
      method: "lifecycle",
      params: { namespace: [], timestamp, data: { event: "completed" } },
    },
  ];
}

export const langGraphCoreFixtureAgent = defineAgent({
  name: "langgraph-core-deterministic-fixture",
  evidenceCoverage: completeEvidenceCoverage,
  send: (input, ctx) => Effect.tryPromise({
      try: async () => {
    const runtimeConverter = createLangGraphEventStream();
    const runtimeEvents: ReturnType<typeof runtimeConverter.add> = [];
    const runtimeMethods: string[] = [];
    const run = await coreGraph.streamEvents({ value: input.text }, { version: "v3" });
    for await (const event of run) {
      runtimeMethods.push(event.method);
      // Raw GraphRunStream ProtocolEvent, unchanged and without a cast.
      runtimeEvents.push(...runtimeConverter.add(event));
    }
    runtimeEvents.push(...runtimeConverter.end());
    if (!runtimeMethods.includes("lifecycle") || runtimeConverter.status !== "completed") {
      throw new Error(
        `LangGraph 1.4.8 runtime receipt lacked completed lifecycle: ${runtimeMethods.join(",") || "<none>"}`,
      );
    }

    // These official @langchain/protocol Event variables own fine-grained
    // messages/tools coverage that a no-model StateGraph does not naturally
    // emit. They are intentionally separate from the runtime receipt above.
    const protocolConverter = createLangGraphEventStream();
    const protocolEvents: ReturnType<typeof protocolConverter.add> = [];
    for (const event of officialCoreFrames(runtimeMethods)) protocolEvents.push(...protocolConverter.add(event));
    protocolEvents.push(...protocolConverter.end());
    if (protocolConverter.status !== "completed") throw new Error("official LangGraph core frames did not complete");

    ctx.session.capture("langgraph-core-runtime-v3");
    return {
      status: "completed",
      events: [...runtimeEvents, ...protocolEvents],
      usage: protocolConverter.usage,
    };

      },
      catch: (cause) => cause,
    }),
});
