// cases: docs/engineering/testing/unit/reports.md
// buildExecutionTree 的单测(定稿见 docs/observability.md「OTLP traces → 统一瀑布图」、
// docs/concepts.md「执行树」词条)。覆盖:无 OTel 时骨架完整、有 OTel 时按 callId 精确合并、
// 唯一关联不上时降级成 telemetry-only 节点(不猜)、同 callId 撞多条 span 时不強行择一、
// call id 撞不上任何节点时同样降级、乱序/截断 transcript 的占位节点、skill.loaded 一等节点、
// tool 失败状态透传、telemetry-only 节点按时间排序追加在骨架之后。

import { describe, expect, it } from "vitest";
import type { StreamEvent, TraceSpan } from "../types.ts";
import {
  buildExecutionTree,
  type ExecutionActionNode,
  type ExecutionSkillNode,
  type ExecutionTelemetryNode,
} from "./execution-tree.ts";
import { IO_MAX, ioText } from "./otlp/select.ts";

function span(over: Partial<TraceSpan> & Pick<TraceSpan, "spanId">): TraceSpan {
  return {
    traceId: "trace-1",
    name: "span",
    startMs: 0,
    endMs: 10,
    ...over,
  };
}

describe("buildExecutionTree", () => {
  it("builds the full skeleton from events alone, with every node's span absent and timingAvailable false", () => {
    const events: StreamEvent[] = [
      { type: "message", role: "user", text: "do the thing" },
      { type: "thinking", text: "let me think" },
      { type: "skill.loaded", skill: "pdf-processing" },
      { type: "action.called", callId: "c1", name: "Bash", input: { cmd: "ls" }, tool: "shell" },
      { type: "action.result", callId: "c1", output: "a.ts\n", status: "completed" },
      { type: "subagent.called", callId: "s1", name: "Task" },
      { type: "subagent.completed", callId: "s1", output: "done", status: "completed" },
      { type: "input.requested", request: { prompt: "approve?" } },
      { type: "compaction", reason: "context full" },
      { type: "error", message: "boom" },
    ];

    const tree = buildExecutionTree(events, []);

    expect(tree.timingAvailable).toBe(false);
    expect(tree.nodes.every((n) => n.kind === "telemetry" || n.span === undefined)).toBe(true);
    expect(tree.nodes.map((n) => n.kind)).toEqual([
      "message",
      "thinking",
      "skill.loaded",
      "action",
      "subagent",
      "input.requested",
      "compaction",
      "error",
    ]);

    const action = tree.nodes[3] as ExecutionActionNode;
    expect(action).toMatchObject({
      kind: "action",
      callId: "c1",
      name: "Bash",
      tool: "shell",
      input: { cmd: "ls" },
      output: "a.ts\n",
      status: "completed",
    });

    const subagent = tree.nodes[4];
    expect(subagent).toMatchObject({
      kind: "subagent",
      callId: "s1",
      name: "Task",
      output: "done",
      status: "completed",
    });
  });

  it("merges a span onto the action node it explicitly correlates to via attributes.call_id, and enriches its attributes with io.tool/io.input/io.output/io.status (same shape as otlp/select.ts's enrichTraceWithIO)", () => {
    const events: StreamEvent[] = [
      { type: "action.called", callId: "c1", name: "Bash", input: { cmd: "ls" }, tool: "shell" },
      { type: "action.result", callId: "c1", output: "ok", status: "completed" },
    ];
    const toolSpan = span({ spanId: "sp1", startMs: 100, endMs: 150, attributes: { call_id: "c1" } });

    const tree = buildExecutionTree(events, [toolSpan]);

    expect(tree.timingAvailable).toBe(true);
    expect(tree.nodes).toHaveLength(1);
    const action = tree.nodes[0] as ExecutionActionNode;
    expect(action.span).toEqual({
      ...toolSpan,
      attributes: {
        call_id: "c1",
        "io.tool": "Bash",
        "io.input": ioText({ cmd: "ls" }),
        "io.output": ioText("ok"),
        "io.status": "completed",
      },
    });
    // node 自己的 input/output 仍是未截断的原始 JsonValue,不受 io.* 注入影响。
    expect(action.input).toEqual({ cmd: "ls" });
    expect(action.output).toBe("ok");
  });

  it("also correlates via the GenAI semantic convention key gen_ai.tool.call.id", () => {
    const events: StreamEvent[] = [
      { type: "action.called", callId: "c1", name: "Bash", input: {}, tool: "shell" },
      { type: "action.result", callId: "c1", output: "ok", status: "completed" },
    ];
    const toolSpan = span({ spanId: "sp1", attributes: { "gen_ai.tool.call.id": "c1" } });

    const tree = buildExecutionTree(events, [toolSpan]);

    const action = tree.nodes[0] as ExecutionActionNode;
    expect(action.span?.attributes).toMatchObject({ "gen_ai.tool.call.id": "c1", "io.tool": "Bash" });
  });

  it("truncates long tool input/output onto the merged span's io.* attributes using the same IO_MAX budget as otlp/select.ts (not a different one)", () => {
    const bigOutput = "x".repeat(IO_MAX + 500);
    const events: StreamEvent[] = [
      { type: "action.called", callId: "c1", name: "Read", input: { path: "/big.txt" }, tool: "file_read" },
      { type: "action.result", callId: "c1", output: bigOutput, status: "completed" },
    ];
    const toolSpan = span({ spanId: "sp1", attributes: { call_id: "c1" } });

    const tree = buildExecutionTree(events, [toolSpan]);

    const action = tree.nodes[0] as ExecutionActionNode;
    const truncated = action.span?.attributes?.["io.output"];
    expect(truncated).toBe(bigOutput.slice(0, IO_MAX) + `…(+${bigOutput.length - IO_MAX})`);
    expect((truncated as string).length).toBeLessThan(bigOutput.length);
    // 节点自身的 output 字段给程序化消费方保留完整未截断内容。
    expect(action.output).toBe(bigOutput);
  });

  it("does not enrich a subagent node's span with io.* keys (no tool-call-shaped input to join)", () => {
    const events: StreamEvent[] = [
      { type: "subagent.called", callId: "s1", name: "Task" },
      { type: "subagent.completed", callId: "s1", output: "done", status: "completed" },
    ];
    const agentSpan = span({ spanId: "sp1", attributes: { call_id: "s1" } });

    const tree = buildExecutionTree(events, [agentSpan]);

    expect(tree.nodes[0]).toMatchObject({ kind: "subagent", span: agentSpan });
    expect(Object.keys(tree.nodes[0].span?.attributes ?? {})).toEqual(["call_id"]);
  });

  it("never guesses by name/text: a span whose call_id matches no node becomes a telemetry-only node, and the skeleton node's span stays absent", () => {
    const events: StreamEvent[] = [
      { type: "action.called", callId: "c1", name: "Bash", input: {}, tool: "shell" },
      { type: "action.result", callId: "c1", output: "ok", status: "completed" },
    ];
    const orphanSpan = span({ spanId: "sp-orphan", attributes: { call_id: "does-not-exist" } });

    const tree = buildExecutionTree(events, [orphanSpan]);

    expect(tree.timingAvailable).toBe(true);
    const action = tree.nodes.find((n) => n.kind === "action") as ExecutionActionNode;
    expect(action.span).toBeUndefined();
    const telemetry = tree.nodes.find((n) => n.kind === "telemetry") as ExecutionTelemetryNode;
    expect(telemetry.span).toEqual(orphanSpan);
  });

  it("a span with no call id at all (pure plumbing/model span) becomes a telemetry-only node", () => {
    const events: StreamEvent[] = [{ type: "message", role: "assistant", text: "hi" }];
    const modelSpan = span({ spanId: "sp-model", attributes: { "gen_ai.operation.name": "chat" } });

    const tree = buildExecutionTree(events, [modelSpan]);

    expect(tree.nodes).toHaveLength(2);
    expect(tree.nodes[1]).toEqual({ id: "telemetry-sp-model", kind: "telemetry", span: modelSpan });
  });

  it("two spans sharing the same call_id cannot be uniquely correlated, so neither merges — both fall back to telemetry-only", () => {
    const events: StreamEvent[] = [
      { type: "action.called", callId: "c1", name: "Bash", input: {}, tool: "shell" },
      { type: "action.result", callId: "c1", output: "ok", status: "completed" },
    ];
    const dup1 = span({ spanId: "sp1", attributes: { call_id: "c1" } });
    const dup2 = span({ spanId: "sp2", attributes: { call_id: "c1" } });

    const tree = buildExecutionTree(events, [dup1, dup2]);

    const action = tree.nodes.find((n) => n.kind === "action") as ExecutionActionNode;
    expect(action.span).toBeUndefined();
    const telemetryIds = tree.nodes.filter((n) => n.kind === "telemetry").map((n) => n.id);
    expect(telemetryIds.sort()).toEqual(["telemetry-sp1", "telemetry-sp2"]);
  });

  it("an action.result with no matching action.called produces a placeholder node instead of being dropped", () => {
    const events: StreamEvent[] = [{ type: "action.result", callId: "orphan", output: "late", status: "completed" }];

    const tree = buildExecutionTree(events, []);

    expect(tree.nodes).toEqual([
      {
        id: "action-orphan",
        kind: "action",
        callId: "orphan",
        name: "unknown",
        input: null,
        output: "late",
        status: "completed",
      },
    ]);
  });

  it("a subagent.completed with no matching subagent.called produces a placeholder node instead of being dropped", () => {
    const events: StreamEvent[] = [{ type: "subagent.completed", callId: "orphan", output: "late", status: "failed" }];

    const tree = buildExecutionTree(events, []);

    expect(tree.nodes).toEqual([
      { id: "subagent-orphan", kind: "subagent", callId: "orphan", name: "unknown", output: "late", status: "failed" },
    ]);
  });

  it("an action that never receives a result stays in a distinct pending state, not silently completed", () => {
    const events: StreamEvent[] = [{ type: "action.called", callId: "c1", name: "Bash", input: {}, tool: "shell" }];

    const tree = buildExecutionTree(events, []);

    expect(tree.nodes[0]).toMatchObject({ kind: "action", status: "pending" });
    expect((tree.nodes[0] as ExecutionActionNode).output).toBeUndefined();
  });

  it("propagates a failed tool result and its error-status span onto the same node", () => {
    const events: StreamEvent[] = [
      { type: "action.called", callId: "c1", name: "Bash", input: { cmd: "false" }, tool: "shell" },
      { type: "action.result", callId: "c1", output: "exit 1", status: "failed" },
    ];
    const failedSpan = span({ spanId: "sp1", status: "error", attributes: { call_id: "c1" } });

    const tree = buildExecutionTree(events, [failedSpan]);

    const action = tree.nodes[0] as ExecutionActionNode;
    expect(action.status).toBe("failed");
    expect(action.span?.status).toBe("error");
  });

  it("a skill.loaded node passes through immediately as its own node — it has no result event to pair with, so it never gets stuck 'pending' the way action/subagent nodes do while awaiting a result", () => {
    const events: StreamEvent[] = [
      { type: "action.called", callId: "c1", name: "Bash", input: {}, tool: "shell" },
      { type: "skill.loaded", skill: "pdf-processing", callId: "toolu_skill" },
      { type: "action.result", callId: "c1", output: "ok", status: "completed" },
      { type: "message", role: "assistant", text: "done" },
    ];

    const tree = buildExecutionTree(events, []);

    // Order preserved, skill node sits between the two halves of the unrelated action call,
    // with no "pending"/"status" field at all (skill.loaded has none — it's not an
    // action/subagent, so there's no "unresolved" state for it to be stuck in).
    expect(tree.nodes.map((n) => n.kind)).toEqual(["action", "skill.loaded", "message"]);
    const skill = tree.nodes[1] as ExecutionSkillNode;
    expect(skill).toEqual({ id: "skill-0", kind: "skill.loaded", skill: "pdf-processing", callId: "toolu_skill" });
    expect("status" in skill).toBe(false);
    const action = tree.nodes[0] as ExecutionActionNode;
    expect(action.status).toBe("completed");
  });

  it("a span whose call_id explicitly correlates to a skill.loaded node's callId enriches that node with timing, same as an action/subagent node (Claude Code's Skill invocation is itself a tool_use, and the OTel mapper copies its tool_use_id onto span.attributes.call_id like any other tool span)", () => {
    const events: StreamEvent[] = [{ type: "skill.loaded", skill: "pdf-processing", callId: "toolu_skill" }];
    const skillSpan = span({ spanId: "sp1", startMs: 5, endMs: 20, attributes: { call_id: "toolu_skill" } });

    const tree = buildExecutionTree(events, [skillSpan]);

    expect(tree.nodes).toHaveLength(1);
    const skill = tree.nodes[0] as ExecutionSkillNode;
    expect(skill.span).toEqual(skillSpan);
    // Not an action node, so no io.* attributes get invented onto it.
    expect(Object.keys(skill.span?.attributes ?? {})).toEqual(["call_id"]);
  });

  it("a skill.loaded node with no callId at all simply never correlates — any span stays telemetry-only, no crash on the missing key", () => {
    const events: StreamEvent[] = [{ type: "skill.loaded", skill: "pdf-processing" }];
    const orphanSpan = span({ spanId: "sp1", attributes: { call_id: "does-not-exist" } });

    const tree = buildExecutionTree(events, [orphanSpan]);

    const skill = tree.nodes.find((n) => n.kind === "skill.loaded") as ExecutionSkillNode;
    expect(skill.span).toBeUndefined();
    expect(tree.nodes.some((n) => n.kind === "telemetry")).toBe(true);
  });

  it("appends telemetry-only nodes after the full skeleton, sorted by span.startMs regardless of arrival order", () => {
    const events: StreamEvent[] = [{ type: "message", role: "user", text: "hi" }];
    const late = span({ spanId: "late", startMs: 500 });
    const early = span({ spanId: "early", startMs: 10 });

    const tree = buildExecutionTree(events, [late, early]);

    expect(tree.nodes.map((n) => n.id)).toEqual(["message-0", "telemetry-early", "telemetry-late"]);
  });

  it("timingAvailable is true whenever spans were supplied, even if none of them correlate", () => {
    const events: StreamEvent[] = [{ type: "message", role: "user", text: "hi" }];
    const tree = buildExecutionTree(events, [span({ spanId: "sp1" })]);
    expect(tree.timingAvailable).toBe(true);
  });

  it("returns an empty tree for empty input", () => {
    const tree = buildExecutionTree([], []);
    expect(tree).toEqual({ nodes: [], timingAvailable: false });
  });

  it("skeleton invariant: with every event kind present, partially-correlating spans change ONLY the `span` field on the nodes they correlate to — node count, order, kind, and every other field are byte-identical to the no-spans run", () => {
    const events: StreamEvent[] = [
      { type: "message", role: "user", text: "do the thing" },
      { type: "thinking", text: "let me think" },
      { type: "skill.loaded", skill: "pdf-processing", callId: "skillcall" },
      { type: "action.called", callId: "c1", name: "Bash", input: { cmd: "ls" }, tool: "shell" },
      { type: "action.result", callId: "c1", output: "a.ts\n", status: "completed" },
      { type: "subagent.called", callId: "s1", name: "Task" },
      { type: "subagent.completed", callId: "s1", output: "done", status: "completed" },
      { type: "input.requested", request: { prompt: "approve?" } },
      { type: "compaction", reason: "context full" },
      { type: "error", message: "boom" },
    ];

    // Correlates to only 2 of the 3 callId-bearing nodes (action c1, skill skillcall);
    // the subagent s1 deliberately gets no span, so this run mixes "correlated" and
    // "uncorrelated-despite-spans-being-available" nodes in the same tree.
    const actionSpan = span({ spanId: "sp-action", startMs: 10, endMs: 20, attributes: { call_id: "c1" } });
    const skillSpan = span({ spanId: "sp-skill", startMs: 30, endMs: 40, attributes: { call_id: "skillcall" } });

    const withoutSpans = buildExecutionTree(events, []);
    const withSpans = buildExecutionTree(events, [actionSpan, skillSpan]);

    expect(withoutSpans.timingAvailable).toBe(false);
    expect(withSpans.timingAvailable).toBe(true);
    // No telemetry-only nodes appended in either run — both supplied spans correlate.
    expect(withoutSpans.nodes).toHaveLength(8);
    expect(withSpans.nodes).toHaveLength(8);

    const stripSpan = (n: (typeof withoutSpans.nodes)[number]): unknown => {
      const { span: _span, ...rest } = n as unknown as { span?: unknown } & globalThis.Record<string, unknown>;
      return rest;
    };

    for (let i = 0; i < withoutSpans.nodes.length; i++) {
      const bare = withoutSpans.nodes[i];
      const enriched = withSpans.nodes[i];
      // Every field except `span` is identical — same kind, same order, same content.
      expect(stripSpan(enriched)).toEqual(stripSpan(bare));
      // The no-spans run never has a span, on any node.
      expect(bare.span).toBeUndefined();
    }

    // The two nodes that DO explicitly correlate gain timing in the enriched run...
    expect((withSpans.nodes[3] as ExecutionActionNode).span?.startMs).toBe(10);
    expect((withSpans.nodes[2] as ExecutionSkillNode).span?.startMs).toBe(30);
    // ...while every other node — including the subagent, which had a callId but no
    // matching span — stays exactly as timing-unavailable as the no-spans run.
    // (nodes: 0 message, 1 thinking, 2 skill*, 3 action*, 4 subagent, 5 input.requested,
    // 6 compaction, 7 error — * = correlated in this run, asserted separately above.)
    for (const i of [0, 1, 4, 5, 6, 7]) {
      expect(withSpans.nodes[i].span).toBeUndefined();
    }
  });

  it("correlation honesty: a span that superficially looks like it belongs to a node — same name as the tool, time window plausibly overlapping — but carries no call_id/gen_ai.tool.call.id attribute must NOT be guessed onto that node; it lands as telemetry-only and the node's span stays absent", () => {
    const events: StreamEvent[] = [
      { type: "action.called", callId: "c1", name: "Bash", input: { cmd: "ls" }, tool: "shell" },
      { type: "action.result", callId: "c1", output: "a.ts\n", status: "completed" },
    ];
    // Deliberately deceptive: span.name matches the tool name exactly, and the time
    // window is exactly where you'd expect the tool call to have run — the only thing
    // missing is an explicit correlation id. A name/time-proximity heuristic would wrongly
    // attach this; explicit-correlation-only must not.
    const imposter = span({
      spanId: "sp-imposter",
      name: "Bash",
      startMs: 0,
      endMs: 5,
      attributes: { "tool.name": "Bash", "tool.input": JSON.stringify({ cmd: "ls" }) },
    });

    const tree = buildExecutionTree(events, [imposter]);

    expect(tree.timingAvailable).toBe(true);
    const action = tree.nodes.find((n) => n.kind === "action") as ExecutionActionNode;
    expect(action.span).toBeUndefined();
    const telemetry = tree.nodes.filter((n) => n.kind === "telemetry") as ExecutionTelemetryNode[];
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0].span).toEqual(imposter);
  });
});
