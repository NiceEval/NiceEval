// cases: docs/engineering/testing/unit/reports.md
// Attempt 详情组件族的单元测试:11 个叶子的 attempt*Data 非空/空证据矩阵与 validate*Data 校验、
// AttemptAssessment 的 source/assertions fallback 展开树、AttemptDetails 的内建顺序(组合函数产出的
// 树,不经渲染)、spec/data 等价与 scope-input page 报错、AttemptConversation 的 loc 分轮与容错、
// 源码树投影另由 record/annotated-source 与 model/conversions 测试覆盖。本文件的观察面全部是
// *Data 计算结果、resolve 后的树节点类型与错误对象;
// 不构造渲染产物——DOM 结构、`<details>` 的 open 折叠标记、text 面下钻命令文本、两面逐字比较均归
// E2E 报告域(docs/engineering/testing/e2e/report.md §5 结构/终端排版)。

import { describe, expect, it } from "vitest";

import type { EvalResult, StreamEvent, Verdict } from "../../../types.ts";
import type { SourceContent as AnnotatedSourceContent } from "../../../record/annotated-source.ts";
import { completeEvidenceCoverage } from "../../../assertions/coverage.ts";
import type { Record, Sample } from "../../../record/index.ts";
import { emptyScopeAndResults } from "../scope.harness.ts";
import type { AttemptEvidence, AttemptEvidenceCapabilities } from "../../../record/attempt-evidence.ts";
import { encodeAttemptLocator, type AttemptIdentity } from "../../../record/locator.ts";
import { createTextContext, renderNodeToText, resolveReportTree, ResolveMemo, type ReportNode, composeOf} from "../../definition/tree.ts";
import { buildReportMeta, defineReport } from "../../definition/report.ts";
import {
  attemptAssertionsData,
  attemptConversationData,
  attemptDiagnosticsData,
  attemptDiffData,
  attemptErrorData,
  attemptFixPromptData,
  attemptSummaryData,
  attemptTimelineData,
  attemptTraceData,
  usageTableData,
} from "./compute.ts";
import { attemptTimelineContent, attemptTraceContent, projectedSourceContent } from "./content.tsx";
import { deriveDiffData } from "../../../assertions/diff.ts";
import {
  Callouts,
  Conversation,
  CopyBlock,
  DiffView,
  SourceView,
  Table,
  Waterfall,
} from "../../definition/primitives.tsx";
import {
  AttemptAssessment,
  AttemptSummary,
} from "./index.tsx";
import {
  validateAssertionsData,
  validateConversationData,
  validateDiagnosticsData,
  validateDiffData,
  validateErrorData,
  validateFixPromptData,
  validateSummaryData,
  validateTimelineData,
  validateTraceData,
  validateUsageData,
} from "./validate.tsx";

// ───────────────────────── fixture ─────────────────────────

function identityOf(overrides: Partial<AttemptIdentity> = {}): AttemptIdentity {
  return { runId: "run-a", evalId: "eval/one", attempt: 0, ...overrides };
}

function resultOf(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    id: "eval/one",
    agent: "agent-x",
    verdict: "passed" as Verdict,
    attempt: 0,
    durationMs: 1000,
    assertions: [],
    evidenceCoverage: completeEvidenceCoverage,
    ...overrides,
  };
}

const FULL_CAPS: AttemptEvidenceCapabilities = { source: true, execution: true, timing: true, diff: true };
const NO_CAPS: AttemptEvidenceCapabilities = { source: false, execution: false, timing: false, diff: false };

function evidenceOf(overrides: Partial<AttemptEvidence> = {}): AttemptEvidence {
  const identity = overrides.identity ?? identityOf();
  return {
    locator: overrides.locator ?? encodeAttemptLocator(identity),
    identity,
    experimentId: overrides.experimentId ?? "exp/a",
    result: overrides.result ?? resultOf(),
    events: overrides.events ?? null,
    evalSource: overrides.evalSource ?? null,
    execution: overrides.execution ?? null,
    diff: overrides.diff ?? null,
    trace: overrides.trace ?? null,
    commands: overrides.commands ?? null,
    artifactPaths: overrides.artifactPaths ?? { dir: "/results/exp/a/eval-one/a0" },
    capabilities: overrides.capabilities ?? NO_CAPS,
  };
}

/** resolve 单个 attempt-input page 节点,注入给定的 evidence。 */
async function resolveOnAttemptPage(node: ReportNode, evidence: AttemptEvidence): Promise<ReportNode> {
  const { scope, results } = emptyScopeAndResults();
  const page = { id: "attempt", input: evidence };
  return resolveReportTree(node, {
    scope,
    results,
    report: buildReportMeta(defineReport(() => node), scope),
    page,
    memo: new ResolveMemo(),
  });
}

/** resolve 一份放在 scope-input page 上的节点(默认 report 页,没有 attempt evidence)。 */
async function resolveOnScopePage(node: ReportNode): Promise<unknown> {
  const { scope, results } = emptyScopeAndResults();
  return resolveReportTree(node, {
    scope,
    results,
    report: buildReportMeta(defineReport(() => node), scope),
    page: { id: "report", input: "sample" },
    memo: new ResolveMemo(),
  });
}

// ───────────────────────── 11 个叶子的非空/空证据矩阵 ─────────────────────────


// ───────────────────────── AttemptConversation:loc 分轮 ─────────────────────────

describe("AttemptSource:send annotation", () => {
  it("轮耗时沿用统一时长格式,156502ms 显示为 2m 37s", () => {
    const source: AnnotatedSourceContent = {
      spine: {
        file: "evals/weather.eval.ts",
        sha256: "sha",
        lines: [{
          line: 1,
          text: 'await t.send("hi");',
          annotations: [{
            kind: "send",
            send: {
              label: "turn1",
              status: "completed",
              durationMs: 156_502,
              loc: { file: "evals/weather.eval.ts", line: 1 },
            },
          }],
          calls: [],
        }],
      },
      detached: [],
      unmapped: { assertions: [], scores: [] },
      summary: { checks: 0, passed: 0, failed: 0, unavailable: 0, aborted: false },
    };

    const projected = projectedSourceContent(source)!;
    const detail = projected.spine.lines[0]!.details![0] as { props: { children: unknown } };
    expect(detail.props.children).toBe("turn1 · completed · 2m 37s");
  });
});

describe("AttemptSummary:show 顶部 text 摘要", () => {
  it("沿用统一时长格式,254334ms 显示为 4m 14s", async () => {
    const evidence = evidenceOf({ result: resultOf({ durationMs: 254_334 }) });
    const tree = await resolveOnAttemptPage(
      <AttemptSummary data={attemptSummaryData(evidence)} />,
      evidence,
    );
    const text = renderNodeToText(tree, createTextContext({ width: 120 }));

    expect(text).toContain("passed · 4m 14s");
    expect(text).not.toContain("254334ms");
  });
});

describe("AttemptConversation:标准事件流按 loc 分轮", () => {
  it("send(带 loc)后紧跟同文本无 loc 回显,回复仍全部聚到 send 行", () => {
    const loc = { file: "evals/a.ts", line: 5 };
    const events: StreamEvent[] = [
      { type: "message", role: "user", text: "hello", loc },
      { type: "message", role: "user", text: "hello" }, // 原生 transcript 回显,无 loc
      { type: "message", role: "assistant", text: "hi there" },
    ];
    const data = attemptConversationData(evidenceOf({ events }))!;
    expect(data.rounds).toHaveLength(1);
    expect(data.rounds[0]!.loc).toEqual(loc);
    expect(data.rounds[0]!.replies).toEqual([{ kind: "assistant", text: "hi there" }]);
    expect(validateConversationData(data)).toBeNull();
  });

  it("闭合事件协议拒绝未归一的未知事件，不把它存进报告完成态", () => {
    const loc = { file: "evals/a.ts", line: 1 };
    const events = [
      { type: "message", role: "user", text: "go", loc },
      { type: "future.thing", weird: true },
      { type: "message", role: "assistant", text: "ok" },
    ] as unknown as StreamEvent[];
    expect(() => attemptConversationData(evidenceOf({ events }))).toThrow("Unsupported StreamEvent variant");
  });

  it("skill.loaded 显示 Skill 名,不伪装成工具调用", () => {
    const loc = { file: "evals/a.ts", line: 1 };
    const events: StreamEvent[] = [
      { type: "message", role: "user", text: "go", loc },
      { type: "skill.loaded", skill: "pdf-tools" },
    ];
    const data = attemptConversationData(evidenceOf({ events }))!;
    expect(data.rounds[0]!.replies).toEqual([{ kind: "skill", skill: "pdf-tools" }]);
    expect(validateConversationData(data)).toBeNull();
  });

  it("context.injected 是已知一等事件，保留 source/text 而不落入 raw JSON 兜底", () => {
    const loc = { file: "evals/a.ts", line: 1 };
    const events: StreamEvent[] = [
      { type: "message", role: "user", text: "go", loc },
      { type: "context.injected", source: "SessionStart", text: "project guidance" },
    ];
    const data = attemptConversationData(evidenceOf({ events }))!;
    expect(data.rounds[0]!.replies).toEqual([{ kind: "context", source: "SessionStart", text: "project guidance" }]);
    expect(validateConversationData(data)).toBeNull();
  });

  it("流首无 loc 的 user 消息(旧 artifact)仍开 noloc 兜底轮", () => {
    const events: StreamEvent[] = [{ type: "message", role: "assistant", text: "orphan reply" }];
    const data = attemptConversationData(evidenceOf({ events }))!;
    expect(data.rounds).toHaveLength(1);
    expect(data.rounds[0]!.loc).toBeUndefined();
    expect(data.rounds[0]!.replies).toEqual([{ kind: "assistant", text: "orphan reply" }]);
    expect(validateConversationData(data)).toBeNull();
  });

  it("tool operation.started + finished 按 operationId 合并成一条回复", () => {
    const loc = { file: "evals/a.ts", line: 1 };
    const events: StreamEvent[] = [
      { type: "message", role: "user", text: "go", loc },
      { type: "operation.started", operationId: "c1", operation: { kind: "tool", name: "bash", input: { command: "ls" }, tool: "shell" } },
      { type: "operation.finished", operationId: "c1", kind: "tool", output: "file.txt", status: "completed" },
    ];
    const data = attemptConversationData(evidenceOf({ events }))!;
    expect(data.rounds[0]!.replies).toEqual([
      { kind: "tool", operationId: "c1", name: "bash", tool: "shell", input: { command: "ls" }, output: "file.txt", status: "completed" },
    ]);
    expect(validateConversationData(data)).toBeNull();
  });
});
// 「Attempt 证据数据源」——timeline / trace 投影的时间树语义
// (docs/engineering/testing/unit/reports.md)。
describe("timeline / trace 投影的时间树语义", () => {
  const timelineLocator = "@wf1" as import("../../../record/locator.ts").AttemptLocator;

  it("timeline:phase 主链累计偏移,turn 按 traceId 收 spans,关联不上的落 eval.run 层", () => {
    const rows = attemptTimelineContent({
      locator: timelineLocator,
      phases: [
        { name: "sandbox.create", durationMs: 1_000 },
        {
          name: "eval.run",
          durationMs: 5_000,
          children: [
            { id: "turn-1", key: "agent.turn", label: "turn1", startOffsetMs: 1_200, durationMs: 3_000, traceId: "t1" },
          ],
        },
        { name: "sandbox.stop", durationMs: 500, failed: true },
      ],
      trace: [
        { traceId: "t1", spanId: "root", name: "sampling", startMs: 10_000, endMs: 13_000 },
        { traceId: "t1", spanId: "child", parentSpanId: "root", name: "stream", startMs: 10_500, endMs: 12_000 },
        { traceId: "orphan", spanId: "solo", name: "flush", startMs: 11_000, endMs: 11_200 },
      ],
    })!;
    const nodes = rows[0]!.nodes;
    // phase 沿主链累计,不全为 0;行总时长 = 主链之和
    expect(nodes.map((n) => n.startOffsetMs)).toEqual([0, 1_000, 6_000]);
    expect(rows[0]!.durationMs).toBe(6_500);
    expect(nodes[2]!.failed).toBe(true);
    // eval.run 与 turn 是主干,带 open 展开标记
    const evalRun = nodes[1]!;
    expect(evalRun.open).toBe(true);
    expect(nodes[0]!.open).toBeUndefined();
    // t1 的 spans 是 turn 的 children,锚在该轮起点;span 父子层级保留
    const turn = evalRun.children!.find((c) => c.key === "turn-1")!;
    expect(turn.open).toBe(true);
    const root = turn.children!.find((c) => c.key === "root")!;
    expect(root.startOffsetMs).toBe(1_200);
    expect(root.children!.map((c) => c.key)).toEqual(["child"]);
    expect(root.children![0]!.startOffsetMs).toBe(1_700);
    // 关联不上任何 turn 的 span 不丢弃,落在 eval.run 层
    expect(evalRun.children!.some((c) => c.key === "solo")).toBe(true);
  });

  it("trace:按 parentSpanId 建树,子 span 是 children 而不是被过滤掉", () => {
    const rows = attemptTraceContent({
      locator: timelineLocator,
      spans: [
        { traceId: "t1", spanId: "root", name: "sampling", startMs: 0, endMs: 3_000 },
        { traceId: "t1", spanId: "child", parentSpanId: "root", name: "stream", startMs: 500, endMs: 2_000 },
        { traceId: "t1", spanId: "solo", name: "flush", startMs: 100, endMs: 200 },
      ],
    })!;
    const countAll = (ns: readonly { children?: readonly unknown[] }[]): number =>
      ns.reduce((sum, n) => sum + 1 + countAll((n.children ?? []) as never), 0);
    expect(rows[0]!.nodes).toHaveLength(2); // root 与 solo;child 嵌套在 root 下
    const root = rows[0]!.nodes.find((n) => n.key === "root")!;
    expect(root.children!.map((c) => c.key)).toEqual(["child"]);
    expect(countAll(rows[0]!.nodes)).toBe(3);
  });
});

describe("attemptDiffData:内容被省略的文件投影成字节数 + 原因,不投 patch", () => {
  const diff = deriveDiffData([
    {
      window: "turn1",
      changes: {
        "src/app.ts": { status: "modified", before: "old\n", after: "new\n" },
        "assets/logo.png": { status: "added", elided: { reason: "binary", afterBytes: 3_145_728 } },
        "data/dump.sql": { status: "modified", elided: { reason: "oversized-text", beforeBytes: 1_048_577, afterBytes: 2_097_153 } },
      },
    },
    {
      window: "turn2",
      changes: {
        "data/dump.sql": { status: "modified", elided: { reason: "oversized-text", beforeBytes: 2_097_153, afterBytes: 4_194_304 } },
      },
    },
  ]);

  it("两种省略原因各自带到投影上,字节数取首末省略窗口", () => {
    const data = attemptDiffData(evidenceOf({ diff, capabilities: FULL_CAPS }))!;
    const byPath = new Map(data.files.map((f) => [f.path, f]));
    expect(byPath.get("assets/logo.png")).toMatchObject({
      change: "added",
      added: 0,
      removed: 0,
      elided: { reason: "binary", afterBytes: 3_145_728 },
    });
    // 首个省略窗口的 before 与最后一个省略窗口的 after —— 与 net 同一个口径
    expect(byPath.get("data/dump.sql")).toMatchObject({
      change: "modified",
      elided: { reason: "oversized-text", beforeBytes: 1_048_577, afterBytes: 4_194_304 },
    });
    // 省略的文件窗口段一律不带 patch(没有内容可渲染),两个触及窗口仍如实列出
    expect(byPath.get("data/dump.sql")!.windows).toEqual([{ window: "turn1" }, { window: "turn2" }]);
  });

  it("同一份 diff 里内容内联的文件照常出 patch 与行数", () => {
    const data = attemptDiffData(evidenceOf({ diff, capabilities: FULL_CAPS }))!;
    const inline = data.files.find((f) => f.path === "src/app.ts")!;
    expect(inline.elided).toBeUndefined();
    expect(inline.added).toBe(1);
    expect(inline.removed).toBe(1);
    expect(inline.windows[0]!.patch).toContain("+new");
  });
});
