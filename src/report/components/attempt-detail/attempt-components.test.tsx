// cases: docs/engineering/testing/unit/reports.md
// Attempt 详情组件族的单元测试:11 个叶子的 attempt*Data 非空/空证据矩阵与 validate*Data 校验、
// AttemptAssessment 的 source/assertions fallback 展开树、AttemptDetails 的内建顺序(组合函数产出的
// 树,不经渲染)、spec/data 等价与 scope-input page 报错、AttemptConversation 的 loc 分轮与容错、
// attemptSourceData 的 loc 投影。观察面全部是 *Data 计算结果、resolve 后的树节点类型与错误对象;
// 不构造渲染产物——DOM 结构、`<details>` 的 open 折叠标记、text 面下钻命令文本、两面逐字比较均归
// E2E 报告域(docs/engineering/testing/e2e/report.md §5 结构/终端排版)。

import { describe, expect, it } from "vitest";

import type { AssertionResult, EvalResult, StreamEvent, Verdict } from "../../../types.ts";
import type { Record, Sample } from "../../../record/index.ts";
import { emptyScopeAndResults } from "../scope.harness.ts";
import type { AttemptEvidence, AttemptEvidenceCapabilities } from "../../../record/attempt-evidence.ts";
import { encodeAttemptLocator, type AttemptIdentity } from "../../../record/locator.ts";
import { buildAnnotatedEvalSource } from "../../../record/annotated-source.ts";
import { resolveReportTree, ResolveMemo, type ReportNode, composeOf} from "../../definition/tree.ts";
import { buildReportMeta, defineReport } from "../../definition/report.ts";
import {
  attemptAssertionsData,
  attemptConversationData,
  attemptDiagnosticsData,
  attemptDiffData,
  attemptErrorData,
  attemptFixPromptData,
  attemptSourceData,
  attemptSummaryData,
  attemptTimelineData,
  attemptTraceData,
  usageTableData,
} from "./compute.ts";
import { attemptTimelineContent, attemptTraceContent } from "./content.tsx";
import { deriveDiffData } from "../../../scoring/diff.ts";
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
  validateSourceData,
  validateSummaryData,
  validateTimelineData,
  validateTraceData,
  validateUsageData,
} from "./validate.tsx";

// ───────────────────────── fixture ─────────────────────────

function identityOf(overrides: Partial<AttemptIdentity> = {}): AttemptIdentity {
  return { experimentId: "exp/a", snapshotStartedAt: "2026-07-01T00:00:00.000Z", evalId: "eval/one", attempt: 0, ...overrides };
}

function resultOf(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    id: "eval/one",
    agent: "agent-x",
    verdict: "passed" as Verdict,
    attempt: 0,
    durationMs: 1000,
    assertions: [],
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
async function resolveOnAttemptPage(node: ReportNode, evidence: AttemptEvidence): Promise<unknown> {
  const { scope, results } = emptyScopeAndResults();
  const page = { id: "attempt", input: "attempt" as const, locator: evidence.locator, evidence };
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

  it("混入完全未知的事件类型时该条目原始 JSON 保留,不吞没其余事件", () => {
    const loc = { file: "evals/a.ts", line: 1 };
    const events = [
      { type: "message", role: "user", text: "go", loc },
      { type: "future.thing", weird: true },
      { type: "message", role: "assistant", text: "ok" },
    ] as unknown as StreamEvent[];
    const data = attemptConversationData(evidenceOf({ events }))!;
    expect(data.rounds[0]!.replies.map((r) => r.kind)).toEqual(["raw", "assistant"]);
    expect(data.rounds[0]!.replies[0]).toEqual({ kind: "raw", raw: { type: "future.thing", weird: true } });
    expect(validateConversationData(data)).toBeNull();
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

  it("action.called + action.result 按 callId 合并成一条 tool 回复", () => {
    const loc = { file: "evals/a.ts", line: 1 };
    const events: StreamEvent[] = [
      { type: "message", role: "user", text: "go", loc },
      { type: "action.called", callId: "c1", name: "bash", input: { command: "ls" }, tool: "shell" },
      { type: "action.result", callId: "c1", output: "file.txt", status: "completed" },
    ];
    const data = attemptConversationData(evidenceOf({ events }))!;
    expect(data.rounds[0]!.replies).toEqual([
      { kind: "tool", callId: "c1", name: "bash", tool: "shell", input: { command: "ls" }, output: "file.txt", status: "completed" },
    ]);
    expect(validateConversationData(data)).toBeNull();
  });
});

// bug: memory/attempt-detail-components-shipped-without-styles.md
describe("attemptSourceData:标准事件流按 loc 投影回 send 行", () => {
  it("send 行的 turns 携带 sentText 与按序归并的完整回复", () => {
    const sourcePath = "evals/a.ts";
    const data = attemptSourceData(
      evidenceOf({
        capabilities: { ...NO_CAPS, source: true, execution: true },
        evalSource: {
          sourcePath,
          sourceSha256: "x",
          lines: [
            { line: 1, text: 'import { defineEval } from "niceeval";', assertions: [], sends: [] },
            {
              line: 2,
              text: 'const reply = await t.send("hello");',
              assertions: [],
              sends: [{ label: "s1/t1", status: "completed" as const, durationMs: 120, loc: { file: sourcePath, line: 2 } }],
            },
          ],
          unmapped: [],
          summary: {
            totalAssertions: 0,
            mappedAssertions: 0,
            unmappedAssertions: 0,
            passed: 0,
            failed: 0,
            gate: 0,
            soft: 0,
            totalLines: 2,
            annotatedLines: 1,
          },
        },
        events: [
          { type: "message", role: "user", text: "hello", loc: { file: sourcePath, line: 2 } },
          { type: "message", role: "assistant", text: "assistant reply attached to the source line" },
        ],
      }),
    )!;

    expect(data.lines[1]!.turns[0]).toMatchObject({ label: "s1/t1", sentText: "hello" });
    expect(data.lines[1]!.turns[0]!.replies).toEqual([
      { kind: "assistant", text: "assistant reply attached to the source line" },
    ]);
    expect(data.lines[0]!.turns).toEqual([]);
  });

  it("轮次没有 loc、指向别的文件或越界时进 unlocatedTurns,原样携带完整回复(不在数据层加工/丢失字段)", () => {
    const noLocSourcePath = "evals/b.ts";
    const data = attemptSourceData(
      evidenceOf({
        capabilities: { ...NO_CAPS, source: true },
        evalSource: {
          sourcePath: noLocSourcePath,
          sourceSha256: "x",
          lines: [{ line: 1, text: "export default {};", assertions: [], sends: [] }],
          unmapped: [],
          summary: {
            totalAssertions: 0,
            mappedAssertions: 0,
            unmappedAssertions: 0,
            passed: 0,
            failed: 0,
            gate: 0,
            soft: 0,
            totalLines: 1,
            annotatedLines: 0,
          },
        },
        events: [
          // 无 loc:流首兜底轮。
          { type: "message", role: "user", text: "hello" },
          {
            type: "action.called",
            callId: "c1",
            name: "bash",
            tool: "shell",
            input: { command: "rg --files" },
          },
          {
            type: "action.result",
            callId: "c1",
            output: { output: "a.ts\nb.ts" },
            status: "completed",
          },
          // 有 loc 但指向另一份文件:同样落 unlocatedTurns,不是当前源码的越界行。
          { type: "message", role: "user", text: "second", loc: { file: "other-file.ts", line: 1 } },
          { type: "error", message: "boom" },
        ],
      }),
    )!;

    expect(data.lines[0]!.turns).toEqual([]);
    expect(data.unlocatedTurns).toHaveLength(2);

    const [first, second] = data.unlocatedTurns;
    expect(first).toMatchObject({ label: "t1", status: "completed", sentText: "hello" });
    // 工具调用结果的原始 JsonValue 原样保留(即使不是字符串);字符串化/单行折叠是渲染层的事,
    // 不在这里发生——数据层不能替渲染层背这个锅,也不能在这里悄悄把内容改没了。
    expect(first!.replies).toEqual([
      { kind: "tool", callId: "c1", name: "bash", tool: "shell", input: { command: "rg --files" }, output: { output: "a.ts\nb.ts" }, status: "completed" },
    ]);

    expect(second).toMatchObject({ label: "t2", status: "failed", sentText: "second" });
    expect(second!.replies).toEqual([{ kind: "error", text: "boom" }]);
  });

  const sourcePath = "evals/score.ts";
  /** 用真实的 buildAnnotatedEvalSource 装配(而不是手摆空 lines):断言到源码行的分桶是它的
   *  职责,fixture 手写会漏掉这份逻辑,让 assertions/unmapped 的期望值失真。 */
  function evalSourceOf(lineCount: number, assertions: AssertionResult[] = []) {
    const content = Array.from({ length: lineCount }, (_, i) => `line ${i + 1}`).join("\n");
    return buildAnnotatedEvalSource({ path: sourcePath, content }, assertions);
  }

  it("t.score(...) 给分记录按 loc 投影到源码行,loc 不在展示源码内的进 unmappedScoreEntries(按 groupPath 分组)", () => {
    const data = attemptSourceData(
      evidenceOf({
        capabilities: { ...NO_CAPS, source: true },
        evalSource: evalSourceOf(3),
        result: resultOf({
          scoring: "points",
          scoreEntries: [
            { label: "on line 2", points: 5, loc: { file: sourcePath, line: 2 } },
            { label: "no loc", points: 2 },
            { label: "wrong file", points: 3, loc: { file: "other.ts", line: 1 }, groupPath: ["g1"] },
          ],
        }),
      }),
    )!;
    expect(data.lines[1]!.scoreEntries).toEqual([{ label: "on line 2", points: 5, loc: { file: sourcePath, line: 2 } }]);
    expect(data.lines[0]!.scoreEntries).toEqual([]);
    expect(data.lines[2]!.scoreEntries).toEqual([]);
    expect(data.unmappedScoreEntries).toEqual([
      { group: "", items: [{ label: "no loc", points: 2 }] },
      { group: "g1", items: [{ label: "wrong file", points: 3, loc: { file: "other.ts", line: 1 }, groupPath: ["g1"] }] },
    ]);
    expect(validateSourceData(data)).toBeNull();
  });

  it("计分制 attempt 没有给分记录时 unmappedScoreEntries 不摆空数组,每行 scoreEntries 恒是数组", () => {
    const data = attemptSourceData(
      evidenceOf({ capabilities: { ...NO_CAPS, source: true }, evalSource: evalSourceOf(2), result: resultOf({}) }),
    )!;
    expect(data.unmappedScoreEntries).toBeUndefined();
    expect(data.lines.every((line) => Array.isArray(line.scoreEntries))).toBe(true);
    expect(validateSourceData(data)).toBeNull();
  });

  it("计分制前置中止:中止点(记录顺序最后一条 assertion)标 aborted,其后源码行标 unreached", () => {
    const assertions: AssertionResult[] = [
      { name: "earlier", severity: "soft", outcome: "passed", score: 1, points: 1, loc: { file: sourcePath, line: 1 } },
      { name: "cloned", severity: "gate", outcome: "failed", score: 0, loc: { file: sourcePath, line: 2 } },
    ];
    const data = attemptSourceData(
      evidenceOf({
        capabilities: { ...NO_CAPS, source: true },
        evalSource: evalSourceOf(4, assertions),
        result: resultOf({ verdict: "failed", scoring: "points", assertions }),
      }),
    )!;
    expect(data.lines[0]!.aborted).toBeUndefined();
    expect(data.lines[0]!.unreached).toBeUndefined();
    expect(data.lines[1]!.aborted).toBe(true);
    expect(data.lines[1]!.unreached).toBeUndefined(); // 中止行本身不算未到达
    expect(data.lines[2]!.unreached).toBe(true);
    expect(data.lines[3]!.unreached).toBe(true);
    expect(data.lines[2]!.aborted).toBeUndefined();
    // 行级标记之外,中止断言本身也带 aborted(供 ⤓ 标注渲染,与无源码的 AttemptAssertions 同一份判据)。
    expect(data.lines[1]!.assertions[0]).toMatchObject({ name: "cloned", aborted: true });
    expect(data.lines[0]!.assertions[0]!.aborted).toBeUndefined();
    expect(validateSourceData(data)).toBeNull();
  });

  it("计分制前置中止:没有源码(AttemptAssertions 平铺列表)时,中止断言同样带 aborted 标注", () => {
    const data = attemptAssertionsData(
      evidenceOf({
        result: resultOf({
          verdict: "failed",
          scoring: "points",
          assertions: [
            { name: "earlier", severity: "soft", outcome: "passed", score: 1, points: 1 },
            { name: "cloned", severity: "gate", outcome: "failed", score: 0 },
          ],
        }),
      }),
    )!;
    expect(data.attention.map((a) => a.name)).toEqual(["earlier", "cloned"]);
    expect(data.attention.find((a) => a.name === "cloned")).toMatchObject({ aborted: true });
    expect(data.attention.find((a) => a.name === "earlier")!.aborted).toBeUndefined();
    expect(validateAssertionsData(data)).toBeNull();
  });

  it("中止断言的 loc 不在展示源码内(未捕获或指向别的文件)时,不标注任何行,但断言本身仍带 aborted(落在 unmapped)", () => {
    const assertions: AssertionResult[] = [
      { name: "cloned", severity: "gate", outcome: "failed", score: 0, loc: { file: "other.ts", line: 1 } },
    ];
    const data = attemptSourceData(
      evidenceOf({
        capabilities: { ...NO_CAPS, source: true },
        evalSource: evalSourceOf(2, assertions),
        result: resultOf({ verdict: "failed", scoring: "points", assertions }),
      }),
    )!;
    expect(data.lines.every((l) => !l.aborted && !l.unreached)).toBe(true);
    expect(data.unmapped).toEqual([{ name: "cloned", severity: "gate", outcome: "failed", score: 0, loc: { file: "other.ts", line: 1 }, aborted: true }]);
    expect(validateSourceData(data)).toBeNull();
  });

  it("通过制 / 计分制 passed / 计分制 failed 但非中止来源:不产生 aborted/unreached 标注", () => {
    // 通过制 failed:不是计分制,不判定中止。
    const passRunAssertions: AssertionResult[] = [{ name: "a", severity: "gate", outcome: "failed", score: 0, loc: { file: sourcePath, line: 1 } }];
    const passRunFailed = attemptSourceData(
      evidenceOf({
        capabilities: { ...NO_CAPS, source: true },
        evalSource: evalSourceOf(2, passRunAssertions),
        result: resultOf({ verdict: "failed", assertions: passRunAssertions }),
      }),
    )!;
    expect(passRunFailed.lines.some((l) => l.aborted || l.unreached)).toBe(false);

    // 计分制 passed(即使有丢分):没有中止,不产生标注。
    const scoredAssertions: AssertionResult[] = [{ name: "a", severity: "soft", outcome: "failed", score: 0, points: 0, loc: { file: sourcePath, line: 1 } }];
    const scoredPassed = attemptSourceData(
      evidenceOf({
        capabilities: { ...NO_CAPS, source: true },
        evalSource: evalSourceOf(2, scoredAssertions),
        result: resultOf({ verdict: "passed", scoring: "points", assertions: scoredAssertions }),
      }),
    )!;
    expect(scoredPassed.lines.some((l) => l.aborted || l.unreached)).toBe(false);
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
            { id: "turn-1", kind: "turn", label: "s1/t1", startOffsetMs: 1_200, durationMs: 3_000, traceId: "t1" },
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
      window: "s1/t1",
      changes: {
        "src/app.ts": { status: "modified", before: "old\n", after: "new\n" },
        "assets/logo.png": { status: "added", elided: { reason: "binary", afterBytes: 3_145_728 } },
        "data/dump.sql": { status: "modified", elided: { reason: "oversized-text", beforeBytes: 1_048_577, afterBytes: 2_097_153 } },
      },
    },
    {
      window: "s1/t2",
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
    expect(byPath.get("data/dump.sql")!.windows).toEqual([{ window: "s1/t1" }, { window: "s1/t2" }]);
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
