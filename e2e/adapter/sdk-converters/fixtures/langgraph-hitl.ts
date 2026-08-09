import { randomUUID } from "node:crypto";
import { Command, END, interrupt, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import type { Event } from "@langchain/protocol";
import {
  completeEvidenceCoverage,
  createLangGraphEventStream,
  createSessionSlot,
  defineAgent,
} from "niceeval/adapter";
import { z } from "zod";

const HitlState = z.object({
  prompt: z.string(),
  decision: z.string().optional(),
});

const hitlGraph = new StateGraph(HitlState)
  .addNode("approval_node", () => {
    const decision = interrupt({
      action_request: { action: "approve_change", args: { target: "langgraph-fixture" } },
      description: "Approve the deterministic LangGraph change",
      config: { allow_accept: true, allow_ignore: true },
    });
    return { decision: String(decision) };
  })
  .addEdge(START, "approval_node")
  .addEdge("approval_node", END)
  .compile({ checkpointer: new MemorySaver(), name: "sdk-converters-langgraph-hitl" });

const hitlSlot = createSessionSlot<{ threadId: string; firstSeq: number }>("sdk-converters/langgraph-hitl/run");
const timestamp = 1_786_233_600_000;

function runtimeReceiptMessage(seq: number, text: string): Event[] {
  return [
    {
      type: "event",
      seq,
      method: "messages",
      params: {
        namespace: [],
        timestamp,
        node: "runtime_receipt",
        data: { event: "message-start", role: "ai", id: `runtime-receipt-${seq}` },
      },
    },
    {
      type: "event",
      seq: seq + 1,
      method: "messages",
      params: {
        namespace: [],
        timestamp,
        node: "runtime_receipt",
        data: { event: "content-block-finish", index: 0, content: { type: "text", text } },
      },
    },
    {
      type: "event",
      seq: seq + 2,
      method: "messages",
      params: { namespace: [], timestamp, node: "runtime_receipt", data: { event: "message-finish" } },
    },
  ];
}

function initialProtocolFrames(runtimeMethods: readonly string[]): Event[] {
  return [
    ...runtimeReceiptMessage(1, `langgraph-hitl-runtime-initial:${[...new Set(runtimeMethods)].join(",")}`),
    {
      type: "event",
      seq: 4,
      method: "lifecycle",
      params: { namespace: [], timestamp, data: { event: "started", graph_name: "sdk-converters-langgraph-hitl" } },
    },
    {
      type: "event",
      seq: 5,
      method: "tools",
      params: {
        namespace: [],
        timestamp,
        node: "approval_node",
        data: {
          event: "tool-started",
          tool_call_id: "langgraph-hitl-call",
          tool_name: "approve_change",
          input: { target: "langgraph-fixture" },
        },
      },
    },
    {
      type: "event",
      seq: 6,
      method: "input.requested",
      params: {
        namespace: [],
        timestamp,
        data: {
          interrupt_id: "langgraph-hitl-interrupt",
          payload: {
            action_request: { action: "approve_change", args: { target: "langgraph-fixture" } },
            description: "Approve the deterministic LangGraph change",
            config: { allow_accept: true, allow_ignore: true },
          },
        },
      },
    },
    {
      type: "event",
      seq: 7,
      method: "lifecycle",
      params: { namespace: [], timestamp, data: { event: "interrupted" } },
    },
  ];
}

function resumedProtocolFrames(approved: boolean, runtimeMethods: readonly string[]): Event[] {
  const terminalTool: Event = approved
    ? {
        type: "event",
        seq: 2,
        method: "tools",
        params: {
          namespace: [],
          timestamp,
          node: "approval_node",
          data: {
            event: "tool-finished",
            tool_call_id: "langgraph-hitl-call",
            output: { marker: "langgraph-hitl-approved-output" },
          },
        },
      }
    : {
        type: "event",
        seq: 2,
        method: "tools",
        params: {
          namespace: [],
          timestamp,
          node: "approval_node",
          data: {
            event: "tool-error",
            tool_call_id: "langgraph-hitl-call",
            message: "langgraph-hitl-human-rejected",
          },
        },
      };
  return [
    {
      type: "event",
      seq: 1,
      method: "lifecycle",
      params: { namespace: [], timestamp, data: { event: "started", graph_name: "sdk-converters-langgraph-hitl" } },
    },
    terminalTool,
    ...runtimeReceiptMessage(
      3,
      `${approved ? "langgraph-hitl-approved-marker" : "langgraph-hitl-rejected-marker"};runtime:${[
        ...new Set(runtimeMethods),
      ].join(",")}`,
    ),
    {
      type: "event",
      seq: 6,
      method: "lifecycle",
      params: { namespace: [], timestamp, data: { event: "completed" } },
    },
  ];
}

async function consumeRuntimeIterable(
  run: AsyncIterable<import("@langchain/langgraph").ProtocolEvent>,
): Promise<{ firstSeq: number; methods: string[] }> {
  const converter = createLangGraphEventStream();
  const methods: string[] = [];
  let firstSeq: number | undefined;
  for await (const event of run) {
    firstSeq ??= event.seq;
    methods.push(event.method);
    converter.add(event);
  }
  converter.end();
  if (firstSeq === undefined || !methods.includes("lifecycle")) {
    throw new Error(`LangGraph HITL runtime yielded no lifecycle receipt: ${methods.join(",") || "<none>"}`);
  }
  return { firstSeq, methods };
}

async function consumeInitialRuntimeRun(
  prompt: string,
  threadId: string,
): Promise<{ firstSeq: number; methods: string[] }> {
  const run = await hitlGraph.streamEvents({ prompt }, {
    version: "v3",
    configurable: { thread_id: threadId },
  });
  return consumeRuntimeIterable(run);
}

async function consumeResumedRuntimeRun(
  resume: string,
  threadId: string,
): Promise<{ firstSeq: number; methods: string[] }> {
  const command = new Command<
    string,
    { prompt?: string; decision?: string },
    "__start__" | "approval_node"
  >({ resume });
  const run = await hitlGraph.streamEvents(command, {
    version: "v3",
    configurable: { thread_id: threadId },
  });
  return consumeRuntimeIterable(run);
}

export const langGraphHitlFixtureAgent = defineAgent({
  name: "langgraph-hitl-deterministic-fixture",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input, ctx) {
    const pending = ctx.session.take(hitlSlot);
    if (pending === undefined) {
      const threadId = `langgraph-hitl-${randomUUID()}`;
      const runtime = await consumeInitialRuntimeRun(input.text, threadId);
      ctx.session.capture(threadId);
      ctx.session.set(hitlSlot, { threadId, firstSeq: runtime.firstSeq });

      const converter = createLangGraphEventStream();
      const events: ReturnType<typeof converter.add> = [];
      for (const event of initialProtocolFrames(runtime.methods)) events.push(...converter.add(event));
      events.push(...converter.end());
      return { status: converter.status ?? "failed", events, usage: converter.usage };
    }

    const response = input.responses?.find((candidate) => candidate.requestId === "langgraph-hitl-interrupt");
    if (response?.optionId !== "accept" && response?.optionId !== "ignore") {
      throw new Error("LangGraph HITL response must match the pending interrupt with accept or ignore");
    }
    const approved = response.optionId === "accept";
    const runtime = await consumeResumedRuntimeRun(
      approved ? "accepted" : "ignored",
      pending.threadId,
    );
    if (runtime.firstSeq !== pending.firstSeq) {
      throw new Error(
        `LangGraph resumed run seq did not restart at ${pending.firstSeq}; observed ${runtime.firstSeq}`,
      );
    }

    const converter = createLangGraphEventStream();
    if (!approved) converter.markRejected("langgraph-hitl-call");
    const events: ReturnType<typeof converter.add> = [];
    for (const event of resumedProtocolFrames(approved, runtime.methods)) events.push(...converter.add(event));
    events.push(...converter.end());
    return { status: converter.status ?? "failed", events, usage: converter.usage };
  },
});
