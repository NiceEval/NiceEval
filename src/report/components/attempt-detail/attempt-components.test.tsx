// cases: docs/engineering/unit-tests/reports/cases.md
// Attempt 详情组件族的单元测试:11 个叶子的非空/空证据矩阵、AttemptAssessment 的
// source/assertions fallback、AttemptDetail 的内建顺序、spec/data 等价与 scope-input page
// 报错、AttemptConversation 的 loc 分轮、断言区默认展开规则、AttemptTimeline 的默认折叠。
// 纯渲染,注入数据:直接构造 AttemptEvidence fixture,不 mock fetch(这些组件从不 fetch)。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AssertionResult, EvalResult, StreamEvent, Verdict } from "../../../types.ts";
import type { Results, Scope } from "../../../results/index.ts";
import { makeScope } from "../../../results/select.ts";
import type { AttemptEvidence, AttemptEvidenceCapabilities } from "../../../results/attempt-evidence.ts";
import { encodeAttemptLocator, type AttemptIdentity } from "../../../results/locator.ts";
import { composeOf, createTextContext, renderNodeToText, resolveReportTree, ResolveMemo, type ReportNode } from "../../definition/tree.ts";
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
  attemptUsageData,
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
  AttemptUsage,
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
    artifactPaths: overrides.artifactPaths ?? { dir: "/results/exp/a/eval-one/a0" },
    capabilities: overrides.capabilities ?? NO_CAPS,
  };
}

function scopeAndResults(): { scope: Scope; results: Results } {
  const scope = makeScope("current-evals", [], []);
  const results = { experiments: [], skipped: [], latest: () => scope, current: () => scope } as unknown as Results;
  return { scope, results };
}

/** resolve 单个 attempt-input page 节点,注入给定的 evidence。 */
async function resolveOnAttemptPage(node: ReportNode, evidence: AttemptEvidence): Promise<unknown> {
  const { scope, results } = scopeAndResults();
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
  const { scope, results } = scopeAndResults();
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

  it("AttemptSummary 的 startedAt 与 identity.attempt 两面都可见,startedAt 缺失时两面都不产生该字段", () => {
    const withBoth = evidenceOf({
      identity: identityOf({ attempt: 2 }),
      result: resultOf({ attempt: 2, startedAt: "2026-01-01T12:34:00.000Z" }),
    });
    const dataWithBoth = attemptSummaryData(withBoth);
    const htmlWithBoth = renderToStaticMarkup(<AttemptSummary data={dataWithBoth} /> as never);
    const textWithBoth = renderNodeToText(<AttemptSummary data={dataWithBoth} /> as never, createTextContext({ width: 100 }));
    expect(htmlWithBoth).toContain("2026");
    expect(textWithBoth).toContain("2026");
    expect(htmlWithBoth).toContain("3"); // identity.attempt = 2,显示前 +1
    expect(textWithBoth).toContain("3");

    const withoutStartedAt = evidenceOf({ result: resultOf({ startedAt: undefined }) });
    const dataWithoutStartedAt = attemptSummaryData(withoutStartedAt);
    expect(dataWithoutStartedAt.startedAt).toBeUndefined();
    const htmlWithoutStartedAt = renderToStaticMarkup(<AttemptSummary data={dataWithoutStartedAt} /> as never);
    const textWithoutStartedAt = renderNodeToText(
      <AttemptSummary data={dataWithoutStartedAt} /> as never,
      createTextContext({ width: 100 }),
    );
    expect(htmlWithoutStartedAt).not.toContain("Started");
    expect(textWithoutStartedAt).not.toContain("undefined");
  });

  it("AttemptError:没有 error 时 null,有 error 时结构化字段齐全", () => {
    expect(attemptErrorData(evidenceOf())).toBeNull();
    const withError = evidenceOf({
      result: resultOf({ verdict: "errored", error: { code: "timeout", message: "boom", phase: "eval.run" } }),
    });
    expect(attemptErrorData(withError)).toEqual({ code: "timeout", message: "boom", phase: "eval.run" });
    expect(validateErrorData(attemptErrorData(withError))).toBeNull();
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

  it("AttemptUsage:没有 usage 时 null", () => {
    expect(attemptUsageData(evidenceOf())).toBeNull();
    const withUsage = evidenceOf({ result: resultOf({ usage: { inputTokens: 10, outputTokens: 5 } }) });
    const data = attemptUsageData(withUsage);
    expect(data?.usage.inputTokens).toBe(10);
    expect(validateUsageData(data)).toBeNull();
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
      AttemptUsage,
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

// ───────────────────────── text/web 共享同一份 data ─────────────────────────

describe("text/web 共享同一份 data,不逐字比较", () => {
  it("AttemptSummary 两面都显示相同 verdict 与 locator", () => {
    const evidence = evidenceOf({ result: resultOf({ verdict: "failed" }) });
    const data = attemptSummaryData(evidence);
    const html = renderToStaticMarkup(<AttemptSummary data={data} /> as never);
    const text = renderNodeToText(<AttemptSummary data={data} /> as never, createTextContext({ width: 100 }));
    expect(html).toContain(evidence.locator);
    expect(text).toContain(evidence.locator);
    expect(html).toContain("failed");
    expect(text).toContain("failed");
  });

  it("失败断言的 expected/received 两面都可见(docs/feature/reports/library/attempt-detail.md「在 show 与 view 怎样渲染」表)", () => {
    const assertions: AssertionResult[] = [
      { name: "check", severity: "gate", outcome: "failed", score: 0, detail: "equals(4)", expected: "4", received: "3" },
    ];
    const data = attemptAssertionsData(evidenceOf({ result: resultOf({ verdict: "failed", assertions }) }))!;
    const html = renderToStaticMarkup(<AttemptAssertions data={data} /> as never);
    const text = renderNodeToText(<AttemptAssertions data={data} /> as never, createTextContext({ width: 100 }));
    for (const face of [html, text]) {
      expect(face).toContain("expected: 4");
      expect(face).toContain("received: 3");
    }
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
describe("AttemptSource:GitHub diff 式源码证据交互", () => {
  it("按 loc 把回复挂回 send 行，并输出 token、四种行状态与可展开详情", () => {
    const sourcePath = "evals/a.ts";
    const lines = [
      { line: 1, text: 'import { defineEval } from "niceeval";', assertions: [], sends: [] },
      {
        line: 2,
        text: 'const reply = await t.send("hello");',
        assertions: [],
        sends: [{ label: "s1/t1", status: "completed" as const, durationMs: 120, loc: { file: sourcePath, line: 2 } }],
      },
      {
        line: 3,
        text: "reply.includes('ok');",
        assertions: [{ name: "includes ok", severity: "gate" as const, outcome: "passed" as const, score: 1 }],
        sends: [],
      },
      {
        line: 4,
        text: "reply.includes('done');",
        assertions: [{ name: "includes done", severity: "gate" as const, outcome: "failed" as const, score: 0 }],
        sends: [],
      },
      {
        line: 5,
        text: "reply.score();",
        assertions: [{ name: "quality", severity: "soft" as const, outcome: "failed" as const, score: 0.4, threshold: 0.7 }],
        sends: [],
      },
    ];
    const data = attemptSourceData(
      evidenceOf({
        capabilities: { ...NO_CAPS, source: true, execution: true },
        evalSource: {
          sourcePath,
          sourceSha256: "x",
          lines,
          unmapped: [],
          summary: {
            totalAssertions: 3,
            mappedAssertions: 3,
            unmappedAssertions: 0,
            passed: 1,
            failed: 2,
            gate: 2,
            soft: 1,
            totalLines: 5,
            annotatedLines: 3,
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
    const html = renderToStaticMarkup(<AttemptSource data={data} /> as never);
    expect(html).toContain('<span class="tok-kw">import</span>');
    expect(html).toContain('<span class="tok-str">&quot;niceeval&quot;</span>');
    expect(html).toContain("nre-source-line-send");
    expect(html).toContain("nre-tone-good");
    expect(html).toContain("nre-tone-bad");
    expect(html).toContain("nre-tone-warn");
    expect(html).toContain("assistant reply attached to the source line");
    expect(html).not.toContain("s1/t1");
    expect(html).toContain('<div class="nre-source-line"><span class="nre-source-line-summary">');
    expect((html.match(/<details class="nre-source-line/g) ?? [])).toHaveLength(4);
    expect(html).toMatch(/<details class="nre-source-line nre-tone-bad" open="">/);
  });
});

// ───────────────────────── AttemptTimeline:默认折叠 ─────────────────────────

describe("AttemptTimeline:默认只显示主链,children 收合", () => {
  it("失败最深节点默认展开(HTML 含 open 属性)并带失败标记,祖先不重复标记", () => {
    const evidence = evidenceOf({
      result: resultOf({
        phases: [
          {
            name: "eval.run",
            durationMs: 100,
            children: [
              {
                id: "t1",
                kind: "turn",
                label: "s1/t1",
                startOffsetMs: 0,
                durationMs: 50,
                failed: true,
                children: [{ id: "h1", kind: "hook", label: "hook#1", startOffsetMs: 0, durationMs: 10 }],
              },
            ],
          },
        ],
      }),
    });
    const data = attemptTimelineData(evidence)!;
    const html = renderToStaticMarkup(<AttemptTimeline data={data} /> as never);
    // 失败最深节点(t1,带子节点故渲染为 <details>)默认展开;它的祖先 phase 自己没有 failed 标记
    // (只有真正失败的最深节点才有),所以只有这一处 open,不是逐层重复标记。
    expect(html).toContain('open=""');
    expect(html).toContain("nre-timeline-failed");
    expect((html.match(/nre-timeline-failed/g) ?? [])).toHaveLength(1);
  });

  it("默认(全部通过)不展开:HTML 不含 open 属性", () => {
    const evidence = evidenceOf({
      result: resultOf({
        phases: [{ name: "eval.run", durationMs: 100, children: [{ id: "t1", kind: "turn", label: "s1/t1", startOffsetMs: 0, durationMs: 50 }] }],
      }),
    });
    const data = attemptTimelineData(evidence)!;
    const html = renderToStaticMarkup(<AttemptTimeline data={data} /> as never);
    expect(html).not.toContain('open=""');
  });
});

// ───────────────────────── 渲染矩阵:两面在空/非空两态下都真正渲染一次 ─────────────────────────
// 上面的矩阵只断言了 data 层(null vs 结构化字段);没有一处真正调用大多数叶子的 web/text 渲染
// 函数——一次 .map / JSON.stringify / 递归写错都能在那一层蒙混过关(typecheck 与 build:report
// 只证明能编译、能打包,不证明能跑)。这里对每个叶子直接以 data 形态渲染(不经 resolve,构造
// 方式与「text/web 共享同一份 data」一致):空态两面零可见输出,非空态两面都不抛错且各含一项
// 该叶子独有的标志性字段。AttemptFixPrompt 的 text 面是故意恒为空串(见 attempt-faces.ts 注释:
// 终端已有 locator,不重复整段 prompt),因此单列 textMarker: null 断言「恒空串」而不是子串。
describe("Attempt 详情组件族:渲染矩阵(空/非空两态,两面都真正渲染)", () => {
  const richEvidence = evidenceOf({
    capabilities: FULL_CAPS,
    result: resultOf({
      verdict: "failed",
      error: { code: "timeout", message: "boom", phase: "eval.run" },
      assertions: [
        { name: "a", severity: "gate", outcome: "failed", score: 0, detail: "expected true" },
        { name: "b", severity: "gate", outcome: "passed", score: 1, groupPath: ["g1"] },
      ],
      phases: [
        {
          name: "eval.run",
          durationMs: 100,
          children: [{ id: "t1", kind: "turn", label: "s1/t1", startOffsetMs: 0, durationMs: 50 }],
        },
      ],
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2 },
      diagnostics: [{ code: "cleanup-failed", level: "warning", message: "m", phase: "eval.teardown" }],
    }),
    evalSource: {
      sourcePath: "evals/a.ts",
      sourceSha256: "x",
      lines: [
        {
          line: 1,
          text: "t.expect(1).toBe(1)",
          assertions: [
            {
              name: "a",
              severity: "gate" as const,
              outcome: "failed" as const,
              score: 0,
              detail: "expected true",
              loc: { file: "evals/a.ts", line: 1 },
            },
          ],
          sends: [],
        },
      ],
      unmapped: [],
      summary: {
        totalAssertions: 2,
        mappedAssertions: 1,
        unmappedAssertions: 1,
        passed: 1,
        failed: 1,
        gate: 2,
        soft: 0,
        totalLines: 1,
        annotatedLines: 1,
      },
    },
    events: [
      { type: "message", role: "user", text: "go", loc: { file: "evals/a.ts", line: 1 } },
      { type: "message", role: "assistant", text: "hi there" },
      { type: "action.called", callId: "c1", name: "bash", input: { command: "ls" }, tool: "shell" },
      { type: "action.result", callId: "c1", output: "file.txt", status: "completed" },
    ],
    trace: [
      { traceId: "t1", spanId: "root", name: "attempt", startMs: 0, endMs: 100 },
      { traceId: "t1", spanId: "child", parentSpanId: "root", name: "model-call", startMs: 0, endMs: 50 },
    ],
    diff: {
      windows: [{ window: "s1/t1", changes: { "a.ts": { status: "modified" as const, before: "1\n2", after: "1\n3" } } }],
      files: { "a.ts": { net: "modified" as const, windows: ["s1/t1"] } },
      get: () => "1\n3",
    },
  });

  const emptyEvidence = evidenceOf();

  const LEAVES = [
    { name: "AttemptError", Component: AttemptError, computeData: attemptErrorData, htmlMarker: "boom", textMarker: "boom" },
    {
      name: "AttemptAssertions",
      Component: AttemptAssertions,
      computeData: attemptAssertionsData,
      htmlMarker: "expected true",
      textMarker: "expected true",
    },
    { name: "AttemptSource", Component: AttemptSource, computeData: attemptSourceData, htmlMarker: "evals/a.ts", textMarker: "evals/a.ts" },
    { name: "AttemptFixPrompt", Component: AttemptFixPrompt, computeData: attemptFixPromptData, htmlMarker: "exp/a", textMarker: null },
    { name: "AttemptTimeline", Component: AttemptTimeline, computeData: attemptTimelineData, htmlMarker: "eval.run", textMarker: "eval.run" },
    {
      name: "AttemptConversation",
      Component: AttemptConversation,
      computeData: attemptConversationData,
      htmlMarker: "hi there",
      textMarker: "hi there",
    },
    {
      name: "AttemptDiagnostics",
      Component: AttemptDiagnostics,
      computeData: attemptDiagnosticsData,
      htmlMarker: "cleanup-failed",
      textMarker: "cleanup-failed",
    },
    { name: "AttemptUsage", Component: AttemptUsage, computeData: attemptUsageData, htmlMarker: "input tokens", textMarker: "tokens" },
    {
      name: "AttemptTrace",
      Component: AttemptTrace,
      computeData: attemptTraceData,
      htmlMarker: "model-call",
      textMarker: "trace:",
    },
    { name: "AttemptDiff", Component: AttemptDiff, computeData: attemptDiffData, htmlMarker: "a.ts", textMarker: "a.ts" },
  ] as const;

  it.each(LEAVES)("$name:空态两面零输出,非空态两面都渲染且各含标志字段", ({ Component, computeData, htmlMarker, textMarker }) => {
    const emptyData = computeData(emptyEvidence);
    expect(emptyData).toBeNull();
    expect(renderToStaticMarkup(<Component data={emptyData as never} /> as never)).toBe("");
    expect(renderNodeToText(<Component data={emptyData as never} /> as never, createTextContext({ width: 100 }))).toBe("");

    const loadedData = computeData(richEvidence);
    expect(loadedData).not.toBeNull();
    const html = renderToStaticMarkup(<Component data={loadedData as never} /> as never);
    const text = renderNodeToText(<Component data={loadedData as never} /> as never, createTextContext({ width: 100 }));
    expect(html).toContain(htmlMarker);
    if (textMarker === null) expect(text).toBe("");
    else expect(text).toContain(textMarker);
  });

  it("AttemptSummary(恒非空)两面都渲染完整证据且含 locator/verdict", () => {
    const data = attemptSummaryData(richEvidence);
    const html = renderToStaticMarkup(<AttemptSummary data={data} /> as never);
    const text = renderNodeToText(<AttemptSummary data={data} /> as never, createTextContext({ width: 100 }));
    expect(html).toContain(richEvidence.locator);
    expect(text).toContain(richEvidence.locator);
    expect(html).toContain("failed");
    expect(text).toContain("failed");
  });

  // 五个证据组件(AttemptSource/AttemptTimeline/AttemptConversation/AttemptTrace/AttemptDiff)的
  // text 面都拼 `niceeval show <locator> --X` 下钻命令;docs/feature/reports/library/
  // attempt-detail.md「在 show 与 view 怎样渲染」要求"保留完整 locator"——没有 locator 的裸
  // `niceeval show --X` 不可执行,不能算满足契约。命令由宿主经 ctx.attemptCommand 注入
  // (report.ts DEFAULT_ATTEMPT_COMMAND),没有 attempt-input page 时不存在,行退化为纯文本
  // (与 traceWaterfallText 同一套退化规则),不生成假命令。
  describe("证据组件的 text 面下钻命令携带完整 locator", () => {
    const attemptCommand = (locator: string) => `niceeval show ${locator}`;
    const withCommand = createTextContext({ width: 100, attemptCommand });
    const withoutCommand = createTextContext({ width: 100 });

    const COMMANDED = [
      { name: "AttemptSource", computeData: attemptSourceData, Component: AttemptSource, flag: "--source" },
      { name: "AttemptTimeline", computeData: attemptTimelineData, Component: AttemptTimeline, flag: "--timing" },
      { name: "AttemptConversation", computeData: attemptConversationData, Component: AttemptConversation, flag: "--execution" },
      { name: "AttemptTrace", computeData: attemptTraceData, Component: AttemptTrace, flag: "--timing" },
      { name: "AttemptDiff", computeData: attemptDiffData, Component: AttemptDiff, flag: "--diff" },
    ] as const;

    it.each(COMMANDED)("$name:ctx.attemptCommand 存在时命令携带 locator,不存在时优雅退化(不生成假命令)", ({ computeData, Component, flag }) => {
      const data = computeData(richEvidence);
      expect(data).not.toBeNull();
      const withText = renderNodeToText(<Component data={data as never} /> as never, withCommand);
      expect(withText).toContain(`niceeval show ${richEvidence.locator} ${flag}`);
      const withoutText = renderNodeToText(<Component data={data as never} /> as never, withoutCommand);
      expect(withoutText).not.toContain("niceeval show");
      expect(withoutText).not.toContain(flag);
    });
  });

  it("AttemptSource:失败断言的 text 面锚点含完整 file:line:col,可直接复制定位", () => {
    const data = attemptSourceData(richEvidence)!;
    const text = renderNodeToText(<AttemptSource data={data} /> as never, createTextContext({ width: 100 }));
    expect(text).toContain("source: evals/a.ts:1");
  });
});
