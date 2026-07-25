// cases: docs/engineering/testing/unit/reports.md
// Attempt 详情组件族的单元测试:11 个叶子的 attempt*Data 非空/空证据矩阵与 validate*Data 校验、
// AttemptAssessment 的 source/assertions fallback 展开树、AttemptDetail 的内建顺序(组合函数产出的
// 树,不经渲染)、spec/data 等价与 scope-input page 报错、AttemptConversation 的 loc 分轮与容错、
// attemptSourceData 的 loc 投影。观察面全部是 *Data 计算结果、resolve 后的树节点类型与错误对象;
// 不构造渲染产物——DOM 结构、`<details>` 的 open 折叠标记、text 面下钻命令文本、两面逐字比较均归
// E2E 报告域(docs/engineering/testing/e2e/report.md §5 结构/终端排版)。

import { describe, expect, it } from "vitest";

import type { AssertionResult, EvalResult, StreamEvent, Verdict } from "../../../types.ts";
import type { Results, Scope } from "../../../results/index.ts";
import { emptyScopeAndResults } from "../scope.harness.ts";
import type { AttemptEvidence, AttemptEvidenceCapabilities } from "../../../results/attempt-evidence.ts";
import { encodeAttemptLocator, type AttemptIdentity } from "../../../results/locator.ts";
import { buildAnnotatedEvalSource } from "../../../results/annotated-source.ts";
import { composeOf, resolveReportTree, ResolveMemo, type ReportNode } from "../../definition/tree.ts";
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
import {
  AttemptAssertions,
  AttemptAssessment,
  AttemptConversation,
  AttemptDetail,
  AttemptDiagnostics,
  AttemptDiff,
  AttemptError,
  AttemptFixPrompt,
  AttemptSource,
  AttemptSummary,
  AttemptTimeline,
  AttemptTrace,
  UsageTable,
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
} from "./index.tsx";

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
    report: buildReportMeta(defineReport(node), scope),
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
    report: buildReportMeta(defineReport(node), scope),
    page: { id: "report", input: "scope" },
    memo: new ResolveMemo(),
  });
}

// ───────────────────────── 11 个叶子的非空/空证据矩阵 ─────────────────────────

describe("Attempt 详情组件族:非空/空证据矩阵", () => {
  it("AttemptSummary 恒非空", () => {
    const evidence = evidenceOf({ capabilities: FULL_CAPS });
    const data = attemptSummaryData(evidence);
    expect(data.locator).toBe(evidence.locator);
    expect(data.verdict).toBe("passed");
    expect(validateSummaryData(data)).toBeNull();
  });

  it("AttemptSummary 的 startedAt 取自 result.startedAt,identity.attempt 是零基下标,缺失 startedAt 时字段不产生", () => {
    const withBoth = evidenceOf({
      identity: identityOf({ attempt: 2 }),
      result: resultOf({ attempt: 2, startedAt: "2026-01-01T12:34:00.000Z" }),
    });
    const dataWithBoth = attemptSummaryData(withBoth);
    expect(dataWithBoth.startedAt).toBe("2026-01-01T12:34:00.000Z");
    expect(dataWithBoth.identity.attempt).toBe(2);

    const withoutStartedAt = evidenceOf({ result: resultOf({ startedAt: undefined }) });
    const dataWithoutStartedAt = attemptSummaryData(withoutStartedAt);
    expect(dataWithoutStartedAt.startedAt).toBeUndefined();
  });

  it("AttemptSummary:计分制 attempt 加本轮挣分字段,通过制省略(不摆 null 占位),题型判定读定义期 scoring", () => {
    const assertions: AssertionResult[] = [
      { name: "a", severity: "gate", outcome: "passed", score: 1, points: 1 },
      { name: "b", severity: "soft", outcome: "failed", score: 0, points: 0 },
    ];
    const scored = evidenceOf({
      result: resultOf({ scoring: "points", assertions, scoreEntries: [{ label: "bonus", points: 2 }] }),
    });
    expect(attemptSummaryData(scored).totalScore).toBe(3); // 1(a) + 0(b) + 2(scoreEntry)

    // 题型判定读定义期 scoring,不从「assertions 是否带 points」反推:通过制 eval 即使意外带了
    // points 字段也不产生这个读数(现实里通过制的 AssertionHandle 类型层没有 .points())。
    const passRun = evidenceOf({ result: resultOf({ scoring: "pass", assertions }) });
    expect(attemptSummaryData(passRun).totalScore).toBeUndefined();
    expect("totalScore" in attemptSummaryData(passRun)).toBe(false);

    const scoringOmitted = evidenceOf({ result: resultOf({ assertions: [] }) });
    expect(attemptSummaryData(scoringOmitted).totalScore).toBeUndefined();
  });

  it("AttemptError:没有 error 时 null,有 error 时结构化字段齐全", () => {
    expect(attemptErrorData(evidenceOf())).toBeNull();
    const withError = evidenceOf({
      result: resultOf({ verdict: "errored", error: { code: "timeout", message: "boom", phase: "eval.run" } }),
    });
    expect(attemptErrorData(withError)).toEqual({ code: "timeout", message: "boom", phase: "eval.run", locator: withError.locator });
    expect(validateErrorData(attemptErrorData(withError))).toBeNull();
  });

  it("AttemptError:message 疑似只剩失败命令 stdout/stderr 的截断尾部时带 commandEvidenceHint,提示 --execution 完整证据", () => {
    const stderr = "npm error code EACCES\nnpm error path /usr/lib/node_modules/pnpm\n" + "x".repeat(600);
    const truncatedMessage = stderr.slice(-500); // Eval 自己 .slice(-500) 拼进异常 —— 只剩尾部
    const withTruncatedError = evidenceOf({
      result: resultOf({ verdict: "errored", error: { code: "turn-failed", message: truncatedMessage, phase: "eval.run" } }),
      commands: [{ timingNodeId: "n1", phase: "eval.setup", display: "npm install -g pnpm", exitCode: 243, stdout: "", stderr }],
    });
    const data = attemptErrorData(withTruncatedError);
    expect(data?.commandEvidenceHint).toBe(true);
    expect(validateErrorData(data)).toBeNull();

    // message 是完整 stderr(没有被截掉任何内容)时不提示——没有「更多证据」可看。
    const withFullError = evidenceOf({
      result: resultOf({ verdict: "errored", error: { code: "turn-failed", message: stderr, phase: "eval.run" } }),
      commands: [{ timingNodeId: "n1", phase: "eval.setup", display: "npm install -g pnpm", exitCode: 243, stdout: "", stderr }],
    });
    expect(attemptErrorData(withFullError)?.commandEvidenceHint).toBeUndefined();

    // 没有失败命令证据时同样不提示,即使 message 碰巧很短。
    const withoutCommands = evidenceOf({
      result: resultOf({ verdict: "errored", error: { code: "turn-failed", message: "boom", phase: "eval.run" } }),
    });
    expect(attemptErrorData(withoutCommands)?.commandEvidenceHint).toBeUndefined();
  });

  it("AttemptAssertions:没有 assertion 时 null,有时按 attention/passedGroups 分桶", () => {
    expect(attemptAssertionsData(evidenceOf())).toBeNull();
    const assertions: AssertionResult[] = [
      { name: "a", severity: "gate", outcome: "failed", score: 0 },
      { name: "b", severity: "gate", outcome: "passed", score: 1, groupPath: ["g1"] },
      { name: "c", severity: "gate", outcome: "passed", score: 1, groupPath: ["g1"] },
    ];
    const data = attemptAssertionsData(evidenceOf({ result: resultOf({ verdict: "failed", assertions }) }))!;
    expect(data.attention.map((a) => a.name)).toEqual(["a"]);
    expect(data.passedGroups).toEqual([{ group: "g1", items: [assertions[1], assertions[2]] }]);
    expect(data.scoreEntries).toBeUndefined(); // 通过制 attempt 恒没有给分记录,不摆空数组
    expect(validateAssertionsData(data)).toBeNull();
  });

  it("AttemptAssertions:计分制 eval 的 .points 挣分随断言一起出现,不需要单独投影", () => {
    const assertions: AssertionResult[] = [
      { name: "a", severity: "gate", outcome: "passed", score: 1, points: 3 },
      { name: "b", severity: "gate", outcome: "failed", score: 0, points: 0 },
    ];
    const data = attemptAssertionsData(
      evidenceOf({ result: resultOf({ verdict: "failed", scoring: "points", assertions }) }),
    )!;
    // 得分点(含 passed)豁免 passed 收纳:两条都进平铺列表,按原始声明顺序。
    expect(data.attention.map((a) => a.name)).toEqual(["a", "b"]);
    expect((data.attention[0] as { points?: number }).points).toBe(3); // passed 得分点如实显示挣到的分
    expect((data.attention[1] as { points?: number }).points).toBe(0); // 挂了的检查点如实显示挣到 0 分,不隐藏
    expect(data.passedGroups).toEqual([]); // 没有不带 .points 的 passed 观测断言
    expect(validateAssertionsData(data)).toBeNull();
  });

  it("AttemptAssertions:收纳只作用于不带 .points 的观测断言,得分点挣满计数只数带 .points 的断言", () => {
    const assertions: AssertionResult[] = [
      { name: "a", severity: "gate", outcome: "passed", score: 1, points: 3, groupPath: ["g1"] }, // 得分点:豁免收纳
      { name: "b", severity: "gate", outcome: "passed", score: 1, groupPath: ["g1"] }, // 不带 points:走收纳
      { name: "c", severity: "soft", outcome: "failed", score: 0, points: 0 }, // 丢分得分点
      { name: "d", severity: "soft", outcome: "unavailable", reason: "no-key" }, // 非得分点的 unavailable,不进挣满计数分母
    ];
    const data = attemptAssertionsData(
      evidenceOf({ result: resultOf({ verdict: "passed", scoring: "points", assertions }) }),
    )!;
    expect(data.attention.map((a) => a.name)).toEqual(["a", "c", "d"]);
    expect(data.passedGroups).toEqual([{ group: "g1", items: [assertions[1]] }]);
    // 2 个得分点(a、c),a 挣满(score===1)、c 没挣满(score===0);d 不带 points,不计入分母。
    expect(data.scorePointsEarned).toEqual({ earned: 1, total: 2 });
    expect(validateAssertionsData(data)).toBeNull();
  });

  it("AttemptAssertions:t.score(label, n) 的给分记录按 groupPath 分组,与 passedGroups 同一套算法", () => {
    const data = attemptAssertionsData(
      evidenceOf({
        result: resultOf({
          verdict: "passed",
          scoring: "points",
          scoreEntries: [
            { label: "代码精简", points: 15, groupPath: ["代码质量"] },
            { label: "重构说明", points: 16, groupPath: ["代码质量"] },
            { label: "无分组给分", points: 2 },
          ],
        }),
      }),
    )!;
    expect(data.attention).toEqual([]); // 没有 assertions,但存在给分记录,data 不是 null
    expect(data.passedGroups).toEqual([]);
    expect(data.scoreEntries).toEqual([
      { group: "代码质量", items: [{ label: "代码精简", points: 15, groupPath: ["代码质量"] }, { label: "重构说明", points: 16, groupPath: ["代码质量"] }] },
      { group: "", items: [{ label: "无分组给分", points: 2 }] },
    ]);
    expect(validateAssertionsData(data)).toBeNull();
  });

  it("AttemptSource:没有 source 时 null(evalSource null 或 capability 假)", () => {
    expect(attemptSourceData(evidenceOf())).toBeNull();
    const withSource = evidenceOf({
      capabilities: { ...NO_CAPS, source: true },
      evalSource: {
        sourcePath: "evals/a.ts",
        sourceSha256: "x",
        lines: [{ line: 1, text: "t.expect(1).toBe(1)", assertions: [], sends: [] }],
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
    });
    expect(attemptSourceData(withSource)?.sourcePath).toBe("evals/a.ts");
    expect(validateSourceData(attemptSourceData(withSource))).toBeNull();
  });

  it("AttemptFixPrompt:passed 时 null,failed 且有可归因原因时给出可复制 prompt", () => {
    expect(attemptFixPromptData(evidenceOf())).toBeNull();
    const failed = evidenceOf({
      result: resultOf({
        verdict: "failed",
        assertions: [{ name: "check", severity: "gate", outcome: "failed", score: 0, detail: "expected true" }],
      }),
    });
    const data = attemptFixPromptData(failed);
    expect(data?.prompt).toContain("exp/a");
    expect(data?.prompt).toContain(`niceeval show ${failed.locator}`);
    expect(validateFixPromptData(data)).toBeNull();
  });

  it("AttemptFixPrompt:计分制三态——丢分/中止非 null,挣满且未中止 null,通过制 passed 恒 null", () => {
    // 通过制 passed:即使 verdict 是 passed,scoring 省略时恒 null(既有行为不变)。
    expect(attemptFixPromptData(evidenceOf({ result: resultOf({ verdict: "passed" }) }))).toBeNull();

    // 计分制 passed 但有丢分得分点:可操作失败,非 null,围绕丢分检查点组装。
    const lostPoints = evidenceOf({
      result: resultOf({
        verdict: "passed",
        scoring: "points",
        assertions: [
          { name: "healthy", severity: "soft", outcome: "failed", score: 0, points: 0, detail: "exit 1" },
          { name: "installed", severity: "gate", outcome: "passed", score: 1, points: 1 },
        ],
      }),
    });
    const lostPointsData = attemptFixPromptData(lostPoints);
    expect(lostPointsData).not.toBeNull();
    expect(lostPointsData?.prompt).toContain("healthy");
    expect(lostPointsData?.prompt).not.toMatch(/^Fix the failing eval/); // 丢分不是「失败」,措辞分开
    expect(validateFixPromptData(lostPointsData)).toBeNull();

    // 计分制 passed 且全部得分点挣满:没有可操作失败,null。
    const earnedInFull = evidenceOf({
      result: resultOf({
        verdict: "passed",
        scoring: "points",
        assertions: [{ name: "installed", severity: "gate", outcome: "passed", score: 1, points: 1 }],
      }),
    });
    expect(attemptFixPromptData(earnedInFull)).toBeNull();

    // 计分制 failed(前置中止):仍走既有 failed 分支,非 null。
    const aborted = evidenceOf({
      result: resultOf({
        verdict: "failed",
        scoring: "points",
        assertions: [{ name: "cloned", severity: "gate", outcome: "failed", score: 0 }],
      }),
    });
    expect(attemptFixPromptData(aborted)).not.toBeNull();
  });

  it("AttemptTimeline:没有 phase 时 null", () => {
    expect(attemptTimelineData(evidenceOf())).toBeNull();
    const withPhases = evidenceOf({
      result: resultOf({ phases: [{ name: "eval.run", durationMs: 10 }] }),
      trace: [{ traceId: "t1", spanId: "s1", name: "model-call", startMs: 0, endMs: 100 }],
    });
    const data = attemptTimelineData(withPhases);
    expect(data?.phases).toHaveLength(1);
    expect(validateTimelineData(data)).toBeNull();
  });

  it("AttemptConversation:没有 events 时 null", () => {
    expect(attemptConversationData(evidenceOf())).toBeNull();
    expect(attemptConversationData(evidenceOf({ events: [] }))).toBeNull();
  });

  it("AttemptDiagnostics:没有 diagnostics 时 null", () => {
    expect(attemptDiagnosticsData(evidenceOf())).toBeNull();
    const withDiag = evidenceOf({
      result: resultOf({ diagnostics: [{ code: "cleanup-failed", level: "warning", message: "m", phase: "eval.teardown" }] }),
    });
    const data = attemptDiagnosticsData(withDiag);
    expect(data?.groups).toEqual([
      { phase: "eval.teardown", items: [{ code: "cleanup-failed", level: "warning", message: "m", phase: "eval.teardown" }] },
    ]);
    expect(validateDiagnosticsData(data)).toBeNull();
  });

  it("UsageTable:没有 turns/toolCalls/usage 时 null", () => {
    expect(usageTableData(evidenceOf())).toBeNull();
  });

  it("UsageTable:身份字段恒有(locator/experimentId/evalId/attempt/verdict),usage 有即非 null", () => {
    const evidence = evidenceOf({ result: resultOf({ verdict: "failed", usage: { inputTokens: 10, outputTokens: 5 } }) });
    const data = usageTableData(evidence)!;
    expect(data.locator).toBe(evidence.locator);
    expect(data.experimentId).toBe(evidence.identity.experimentId);
    expect(data.evalId).toBe(evidence.identity.evalId);
    expect(data.attempt).toBe(evidence.identity.attempt);
    expect(data.verdict).toBe("failed");
    expect(data.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(validateUsageData(data)).toBeNull();
  });

  it("UsageTable:turns/toolCalls 来自事件流(与 usage 独立),没有 events 时省略而不是 0", () => {
    const events: StreamEvent[] = [
      { type: "message", role: "user", text: "go" },
      { type: "message", role: "assistant", text: "ok" },
      { type: "action.called", callId: "c1", name: "read", tool: "file_read", input: {} },
      { type: "action.called", callId: "c2", name: "read", tool: "file_read", input: {} },
    ];
    const withEvents = usageTableData(evidenceOf({ events }))!;
    expect(withEvents.turns).toBe(1); // 只数 assistant message
    expect(withEvents.toolCalls).toBe(2);
    expect(withEvents.usage).toBeUndefined(); // 没有落盘 usage 时该字段省略,不是空对象

    // 有 usage 但没有 events:turns/toolCalls 整对省略(不是 0——0 是"有 events 但零轮"的事实,
    // 这里是"压根没有事件骨架")。
    const withoutEvents = usageTableData(evidenceOf({ result: resultOf({ usage: { inputTokens: 1, outputTokens: 1 } }) }))!;
    expect(withoutEvents.turns).toBeUndefined();
    expect(withoutEvents.toolCalls).toBeUndefined();
    expect("turns" in withoutEvents).toBe(false);
  });

  it("UsageTable:events 存在但零轮/零工具调用时,turns/toolCalls 如实为 0(观测事实,不是缺失)", () => {
    const events: StreamEvent[] = [{ type: "message", role: "user", text: "go" }];
    const data = usageTableData(evidenceOf({ events }))!;
    expect(data.turns).toBe(0);
    expect(data.toolCalls).toBe(0);
    expect("turns" in data).toBe(true);
  });

  it("UsageTable:桶恒互斥,inputTokens 落盘原样透传,不派生第二个输入字段", () => {
    // inputTokens 本身就是未缓存输入(docs/feature/record/architecture.md#usage),
    // "uncached in" 只是 face 层在 cacheReadTokens 在场时给的标注,data 不多一个字段。
    const both = usageTableData(evidenceOf({ result: resultOf({ usage: { inputTokens: 100, outputTokens: 1, cacheReadTokens: 40 } }) }))!;
    expect(both.usage?.inputTokens).toBe(100);
    expect("uncachedInputTokens" in both).toBe(false);
  });

  it("UsageTable:requests 缺失时不出现在 usage 对象里(落盘原样透传,不由 usageTableData 凑值)", () => {
    const withoutRequests = usageTableData(evidenceOf({ result: resultOf({ usage: { inputTokens: 1, outputTokens: 1 } }) }))!;
    expect(withoutRequests.usage?.requests).toBeUndefined();
    expect(withoutRequests.usage && "requests" in withoutRequests.usage).toBe(false);

    const withRequests = usageTableData(evidenceOf({ result: resultOf({ usage: { inputTokens: 1, outputTokens: 1, requests: 4 } }) }))!;
    expect(withRequests.usage?.requests).toBe(4);
  });

  it("UsageTable:estimatedCostUSD 能算出成本时才出现,算不出时整字段省略(不是 null)", () => {
    const withCost = usageTableData(evidenceOf({ result: resultOf({ usage: { inputTokens: 1, outputTokens: 1 }, estimatedCostUSD: 0.5 }) }))!;
    expect(withCost.estimatedCostUSD).toBe(0.5);

    const withoutCost = usageTableData(evidenceOf({ result: resultOf({ usage: { inputTokens: 1, outputTokens: 1 } }) }))!;
    expect(withoutCost.estimatedCostUSD).toBeUndefined();
    expect("estimatedCostUSD" in withoutCost).toBe(false);
  });

  it("AttemptTrace:没有 trace 时 null", () => {
    expect(attemptTraceData(evidenceOf())).toBeNull();
    const withTrace = evidenceOf({ trace: [{ traceId: "t1", spanId: "s1", name: "model-call", startMs: 0, endMs: 100 }] });
    const data = attemptTraceData(withTrace);
    expect(data?.spans).toHaveLength(1);
    expect(validateTraceData(data)).toBeNull();
  });

  it("AttemptDiff:没有变更时 null,net:none 的触碰不进列表", () => {
    expect(attemptDiffData(evidenceOf())).toBeNull();
    const diff = {
      windows: [
        {
          window: "s1/t1",
          changes: {
            "a.ts": { status: "modified" as const, before: "1\n2", after: "1\n3" },
            "b.ts": { status: "modified" as const, before: "x", after: "x" },
          },
        },
      ],
      files: {
        "a.ts": { net: "modified" as const, windows: ["s1/t1"] },
        "b.ts": { net: "none" as const, windows: ["s1/t1"] },
      },
      get: (path: string) => (path === "a.ts" ? "1\n3" : "x"),
    };
    const withDiff = evidenceOf({ capabilities: { ...NO_CAPS, diff: true }, diff });
    const data = attemptDiffData(withDiff);
    expect(data?.files.map((f) => f.path)).toEqual(["a.ts"]);
    expect(data?.files[0]!.lines).toEqual({ added: 1, deleted: 1 });
    expect(validateDiffData(data)).toBeNull();
  });
});

// ───────────────────────── AttemptAssessment / AttemptDetail ─────────────────────────

describe("AttemptAssessment / AttemptDetail(组合组件)", () => {
  it("有 source 时展开树含 AttemptSource 不含 AttemptAssertions;无 source 时相反", async () => {
    for (const [evidence, expectSource] of [
      [evidenceOf({ capabilities: { ...NO_CAPS, source: true } }), true],
      [evidenceOf({ capabilities: NO_CAPS }), false],
    ] as const) {
      const resolved = (await resolveOnAttemptPage(<AttemptAssessment />, evidence)) as { props: { children: Array<{ type: unknown }> } };
      const types = resolved.props.children.map((c) => c.type);
      expect(types).toContain(AttemptError);
      expect(types.includes(AttemptSource)).toBe(expectSource);
      expect(types.includes(AttemptAssertions)).toBe(!expectSource);
    }
  });

  it("在 scope-input page 之外调用时 resolve 报完整用户反馈", async () => {
    await expect(resolveOnScopePage(<AttemptAssessment />)).rejects.toThrow(/attempt-input page/);
  });

  it("AttemptDetail:有 source 时不重复 Conversation，无 source 时在 usage 后保留 fallback", () => {
    // AttemptDetail 自己是组合组件:resolve 会把它(以及嵌套的 AttemptAssessment)递归展开,
    // 所以这里直接检查它的 compose 函数产出的原始树(与「内建报告」测试检查 standard.tsx
    // 原始声明同一手法),不走完整 resolve——那样 AttemptAssessment 会被替换成它自己展开出的
    // <Col> 而不再是 AttemptAssessment 这个类型。
    const compose = composeOf(AttemptDetail)!;
    const childTypes = (evidence: AttemptEvidence): unknown[] => {
      const tree = compose({}, { page: { input: "attempt", evidence } } as never) as unknown as {
        props: { children: Array<{ type: unknown } | null> };
      };
      return tree.props.children.filter((child): child is { type: unknown } => child !== null).map((child) => child.type);
    };
    const withoutSource = childTypes(evidenceOf());
    expect(withoutSource).toEqual([
      AttemptSummary,
      AttemptAssessment,
      AttemptFixPrompt,
      AttemptTimeline,
      AttemptDiagnostics,
      UsageTable,
      AttemptConversation,
      AttemptTrace,
      AttemptDiff,
    ]);

    const withSource = childTypes(
      evidenceOf({
        capabilities: { ...NO_CAPS, source: true },
        evalSource: {
          sourcePath: "evals/a.ts",
          sourceSha256: "x",
          lines: [{ line: 1, text: "", assertions: [], sends: [] }],
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
      }),
    );
    expect(withSource).toEqual(withoutSource.filter((type) => type !== AttemptConversation));
  });
});

// ───────────────────────── spec/data 等价与 scope-input page 报错 ─────────────────────────

describe("叶子组件的 spec/data 形态", () => {
  it("<AttemptSummary /> 在 attempt page 内的 spec 结果与手工 attemptSummaryData(evidence) 深等", async () => {
    const evidence = evidenceOf({ capabilities: FULL_CAPS });
    const resolved = (await resolveOnAttemptPage(<AttemptSummary />, evidence)) as { props: { data: unknown } };
    expect(resolved.props.data).toEqual(attemptSummaryData(evidence));
  });

  it("<AttemptSummary /> 放进 scope-input page 报错,文案含移到 attempt-input page 或传入 evidence", async () => {
    await expect(resolveOnScopePage(<AttemptSummary />)).rejects.toThrow(/attempt-input page/);
  });

  it("显式传 data 时不再取当前 page 的 evidence(scope-input page 上也能直接渲染)", async () => {
    const data = attemptSummaryData(evidenceOf());
    const resolved = (await resolveOnScopePage(<AttemptSummary data={data} />)) as { props: { data: unknown } };
    expect(resolved.props.data).toEqual(data);
  });

  it("同时传 data 与 input 报完整用户反馈,不静默取一边", async () => {
    const evidence = evidenceOf();
    const data = attemptSummaryData(evidence);
    await expect(
      resolveOnScopePage(
        // @ts-expect-error data 与 input 字段互斥,类型层已拒绝;这里模拟无类型 JS 输入
        <AttemptSummary data={data} input={evidence} />,
      ),
    ).rejects.toThrow(/both `data` and `input`/);
  });
});

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
