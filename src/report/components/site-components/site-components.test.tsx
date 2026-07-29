// @ts-nocheck
// cases: docs/engineering/testing/unit/reports.md
// 站点组件的单元测试:Hero 的标题回退链与显式覆盖(resolve 后的 props,不经渲染)、Hero 与手写
// HeroCard 组合的结构严格等价、heroData(latestStartedAt / runs)、groupScopeWarnings(按动作
// 聚合的纯函数:组构成、排序、命令去重、summary 与 detailsOpen 阈值,web/text 两面共用同一份计算)、
// scopeWarningsData(裸 Run[] 输入的空数组语义)、snapshotDiagnosticsData(只投影 diagnostics
// 非空的真实 Run、Sample 与裸 Run[] 同值投影、experiment→startedAt 排序、来源不合并、开放
// code 原样保留)、groupSnapshotDiagnostics(按来源分组的纯函数:组构成、summary 计数与最高严重度,
// web/text 两面共用同一份计算)、copyFixPromptData(prompt 内容与 failures 计数)、traceWaterfallData
// (顶层 span 摘要、排序、trace 缺失语义、runner phases 不进瀑布)。观察面全部是 *Data 计算结果、聚合
// 函数的返回对象与 resolve 后的树节点类型/props;不构造渲染产物——PoweredBy 的品牌行 HTML、
// ScopeWarnings/SnapshotDiagnostics/CopyFixPrompt/TraceWaterfall 的 DOM 与终端排版、AttemptList
// filter 的渐进增强markup 不变量,均归 E2E 报告域(docs/engineering/testing/e2e/report.md §5)。

import { describe, expect, it } from "vitest";

import type { AssertionResult, EvalResult, TraceSpan, Verdict } from "../../../types.ts";
import type { AttemptHandle, Record, Sample, SampleIssue, Run } from "../../../record/index.ts";
import { attemptHandleOf, resultsOf, scopeOf } from "../scope.harness.ts";
import { defineComponent, resolveReportTree, ResolveMemo, type ReportNode } from "../../definition/tree.ts";
import { buildReportMeta, defineReport, type ReportDefinition } from "../../definition/report.ts";
import { pickReportPage, reportTitleText } from "../../runtime/text.ts";
import { renderSamplePage } from "../../runtime/page-render.ts";
import type { DiagnosticRecord } from "../../../types.ts";
import { Hero, HeroCard } from "./index.tsx";
import { toHeroData } from "../../model/conversions.ts";
import { copyFixPromptData, heroData, scopeWarningsData, snapshotDiagnosticsData, traceWaterfallData } from "./compute.ts";
import { groupScopeWarnings } from "./scope-warnings.ts";
import { groupSnapshotDiagnostics } from "./snapshot-diagnostics.ts";

// ───────────────────────── fake 数据(按 results 读取契约造)─────────────────────────

let seq = 0;

function res(id: string, verdict: Verdict, extra: Partial<EvalResult> = {}): EvalResult {
  seq += 1;
  return {
    id,
    agent: "agent-x",
    verdict,
    attempt: 0,
    startedAt: `2026-07-01T00:00:00.${String(seq).padStart(6, "0")}Z`,
    durationMs: 1000,
    assertions: [],
    ...extra,
  };
}

let runSeq = 0;

/** 最小快照构造;traces 按 eval id 提供 trace artifact(缺省 null,与真实懒加载语义一致)。 */
function snap(spec: {
  experimentId: string;
  results: EvalResult[];
  name?: Run["name"];
  runStartedAt?: string;
  traces?: globalThis.Record<string, TraceSpan[]>;
  diagnostics?: DiagnosticRecord[];
}): Run {
  runSeq += 1;
  const startedAt = spec.runStartedAt ?? `2026-06-01T00:00:00.${String(runSeq).padStart(3, "0")}Z`;
  const run = {
    experimentId: spec.experimentId,
    startedAt,
    completedAt: startedAt,
    agent: "agent-x",
    name: spec.name,
    schemaVersion: 1,
    dir: `/results/exp/snap-${runSeq}`,
    ...(spec.diagnostics ? { diagnostics: spec.diagnostics } : {}),
  } as Run;
  const attempts: AttemptHandle[] = spec.results.map((r) =>
    attemptHandleOf(
      run,
      r,
      { run: `exp/snap-${runSeq}`, attempt: `${r.id}/a${r.attempt}` },
      { trace: async () => spec.traces?.[r.id] ?? null },
    ),
  );
  const evals = new Map<string, AttemptHandle[]>();
  for (const attempt of attempts) evals.set(attempt.evalId, [...(evals.get(attempt.evalId) ?? []), attempt]);
  run.evals = [...evals.entries()].map(([id, list]) => ({ id, attempts: list }));
  run.attempts = attempts;
  return run;
}

/** 管线便捷入口:装载 → resolve,停在树节点(与 show/view 同一条 resolve 管线,不带渲染面)。 */
async function resolveDefinition(definition: ReportDefinition, scope: Sample): Promise<unknown> {
  const page = pickReportPage(definition);
  const tree = await renderSamplePage(page, scope);
  return resolveReportTree(tree, {
    scope,
    results: resultsOf(scope.runs),
    report: buildReportMeta(definition, scope),
    page: { id: page.id, input: "sample" },
    memo: new ResolveMemo(),
  });
}

async function resolveOnScope(node: ReportNode, scope: Sample): Promise<unknown> {
  return resolveDefinition(defineReport(() => node), scope);
}

// ───────────────────────── 警告 fixture(按 SampleIssue 联合造,只剩三种 kind)─────────────────────────

function unfinishedSnapshot(id: string): SampleIssue {
  return {
    code: "unfinished-run",
    experimentId: id,
    startedAt: "2026-07-11T00:00:00Z",
    dir: `/results/${id}`,
    // message is rendered from structured issue fields
    // message: `run "${id}" (2026-07-11T00:00:00Z) is unfinished (the process was interrupted); completed attempts are read as-is, but the set may be incomplete — re-run \`niceeval exp ${id}\` for a complete run`,
    // command: `niceeval exp ${id}`,
  };
}

function unreadableSnapshot(dir: string): SampleIssue {
  return {
    code: "unreadable-run",
    dir,
    reason: "malformed",
    // message is rendered from structured issue fields
    // message: `run at "${dir}" is malformed and was unreadable; inspect run.json in that directory for corrupted JSON or a missing required field`,
  };
}

// ───────────────────────── Hero 与 HeroCard ─────────────────────────

describe("Hero 与 HeroCard", () => {
  const heroScope = () =>
    scopeOf([
      snap({ experimentId: "exp/a", results: [res("q1", "passed")], runStartedAt: "2026-07-01T10:00:00Z" }),
      snap({ experimentId: "exp/b", results: [res("q1", "failed")], runStartedAt: "2026-07-03T10:00:00Z" }),
      snap({ experimentId: "exp/c", results: [res("q2", "passed")], runStartedAt: "2026-07-02T10:00:00Z" }),
    ]);

  it("<Hero /> 的 resolve 结果携带走完回退链的站点标题,与浏览器标题(reportTitleText)同源", async () => {
    const scope = heroScope();
    const definition = defineReport({
      title: { en: "Memory Evals" },
      pages: [{ id: "report", title: "Report", render: () => <Hero /> }],
    });
    expect(reportTitleText(definition, scope, "en")).toBe("Memory Evals");
    const meta = buildReportMeta(definition, scope);
    const resolved = (await resolveDefinition(definition, scope)) as { type: unknown; props: { title: unknown } };
    expect(resolved.type).toBe(HeroCard);
    expect(resolved.props.title).toEqual(meta.title);
  });

  it("显式 title prop 覆盖站点声明", async () => {
    const scope = heroScope();
    const resolved = (await resolveOnScope(<Hero title="Custom Hero" />, scope)) as { props: { title: unknown } };
    expect(resolved.props.title).toBe("Custom Hero");
  });

  it("<Hero /> 与手写 <HeroCard title={report.title} data={await toHeroData(sample)} /> resolve 结果结构严格等价", async () => {
    const scope = heroScope();
    const data = await toHeroData(scope);
    const Handwritten = defineComponent(async (_props, ctx) => (
      <HeroCard title={ctx.report.title} data={data} />
    ));
    const [heroResolved, handResolved] = (await Promise.all([
      resolveOnScope(<Hero />, scope),
      resolveOnScope(<Handwritten />, scope),
    ])) as [{ type: unknown; props: unknown }, { type: unknown; props: unknown }];
    expect(heroResolved.type).toBe(HeroCard);
    expect(heroResolved).toEqual(handResolved);
  });

  it("heroData:latestStartedAt 取范围内最新快照开始时间、runs 计贡献快照数", async () => {
    const scope = heroScope();
    const data = await heroData(scope);
    expect(data.latestStartedAt).toBe("2026-07-03T10:00:00Z");
    expect(data.runs).toBe(3);
  });

  it("空 Sample:latestStartedAt 为 null(不编造当前时间),runs 为 0", async () => {
    const empty = scopeOf([]);
    const data = await heroData(empty);
    expect(data).toEqual({ latestStartedAt: null, runs: 0 });
  });
});

// ───────────────────────── ScopeWarnings 的聚合层:groupScopeWarnings ─────────────────────────

describe("groupScopeWarnings(按动作聚合,web/text 两面共用的纯函数)", () => {
  it("带 experimentId 的 unfinished-run 各自成组:组头是实验 id、带徽标与去重后的命令;不同实验各自一组", () => {
    const issues = [unfinishedSnapshot("exp/a"), unfinishedSnapshot("exp/b")];
    const { groups } = groupScopeWarnings(issues, "en");
    expect(groups).toHaveLength(2);
    const groupA = groups.find((g) => g.title === "exp/a")!;
    expect(groupA.badges.map((b) => b.text)).toEqual(["unfinished"]);
    expect(groupA.headCommand).toBe("niceeval exp exp/a");
    const groupB = groups.find((g) => g.title === "exp/b")!;
    expect(groupB.headCommand).toBe("niceeval exp exp/b");
  });

  it("组排序:实验作用域组在前(按实验 id 字典序),非实验作用域组在后;Notice 保留结构化 Issue", () => {
    const dangling: SampleIssue = {
      code: "dangling-evidence",
      experimentId: "exp/c",
      evalId: "q1",
      attempt: 1,
      artifactBase: "result",
      artifacts: ["trace.json"],
    };
    // 声明顺序故意把非实验作用域组放最前,验证排序不依赖出现顺序
    const issues = [unreadableSnapshot("/results/bad"), unfinishedSnapshot("exp/b"), unfinishedSnapshot("exp/a"), dangling];
    const { groups } = groupScopeWarnings(issues, "en");
    const titles = groups.map((g) => g.title);
    // 实验组按 id 字典序排在前:exp/a 先于 exp/b。
    expect(titles.indexOf("exp/a")).toBeLessThan(titles.indexOf("exp/b"));
    // 两个实验组都排在非实验作用域组之前。
    const lastExperimentPos = Math.max(titles.indexOf("exp/a"), titles.indexOf("exp/b"));
    expect(lastExperimentPos).toBeLessThan(titles.indexOf("1 run unreadable"));
    expect(lastExperimentPos).toBeLessThan(titles.indexOf("dangling-evidence"));
    const danglingGroup = groups.find((g) => g.title === "dangling-evidence")!;
    expect(danglingGroup.issues[0]!.issue).toEqual(dangling);
  });

  it("summary 是分类计数汇总、随单复数变化;detailsOpen 阈值是总条数 ≤ 3(跨组计数,不是按组)", () => {
    const two = groupScopeWarnings([unfinishedSnapshot("exp/a"), unfinishedSnapshot("exp/b")], "en");
    expect(two.summary).toBe("2 experiments flagged");
    const one = groupScopeWarnings([unfinishedSnapshot("exp/a")], "en");
    expect(one.summary).toBe("1 experiment flagged");

    const three = [unfinishedSnapshot("exp/a"), unfinishedSnapshot("exp/b"), unreadableSnapshot("/results/bad")];
    expect(groupScopeWarnings(three, "en").detailsOpen).toBe(true);
    const four = [...three, unreadableSnapshot("/results/bad2")];
    expect(groupScopeWarnings(four, "en").detailsOpen).toBe(false);
  });

  it("没有 Notice action 的条目 headCommand 为 null,不硬造动作", () => {
    const noCommand: SampleIssue = { code: "unreadable-run", dir: "/results/bad", reason: "malformed" };
    const { groups } = groupScopeWarnings([noCommand], "en");
    expect(groups[0]!.headCommand).toBeNull();
    expect(groups[0]!.issues[0]!.issue).toEqual(noCommand);
  });

  it("空警告集:零组、空 summary", () => {
    const empty = groupScopeWarnings([], "en");
    expect(empty.groups).toEqual([]);
    expect(empty.summary).toBe("");
  });
});

describe("scopeWarningsData", () => {
  it("Sample 携带的挑选警告原样透出", async () => {
    const issues = [unfinishedSnapshot("exp/a")];
    const scope = scopeOf([snap({ experimentId: "exp/a", results: [res("q1", "passed")] })], issues);
    await expect(scopeWarningsData(scope)).resolves.toEqual(scope.issues);
  });

  it("裸 Run[] 输入没有挑选过程,返回空数组", async () => {
    const scope = scopeOf([snap({ experimentId: "exp/a", results: [res("q1", "passed")] })], [unfinishedSnapshot("exp/a")]);
    await expect(scopeWarningsData(scope.runs)).resolves.toEqual([]);
  });
});

// ───────────────────────── SnapshotDiagnostics ─────────────────────────

function diag(code: string, extra: Partial<DiagnosticRecord> = {}): DiagnosticRecord {
  return { code, level: "warning", message: `${code} happened; check the source`, phase: "experiment.teardown", ...extra };
}

describe("snapshotDiagnosticsData", () => {
  it("只投影 diagnostics 非空的真实 Run;开放 code 原样保留、不携带 evals/AttemptHandle", async () => {
    const withDiag = snap({ experimentId: "exp/a", results: [res("q1", "passed")], diagnostics: [diag("future-code-xyz")] });
    const withoutDiag = snap({ experimentId: "exp/b", results: [res("q1", "passed")] });
    const scope = scopeOf([withDiag, withoutDiag]);
    const data = await snapshotDiagnosticsData(scope);
    expect(data).toEqual([{ experimentId: "exp/a", startedAt: withDiag.startedAt, diagnostics: [diag("future-code-xyz")] }]);
    expect(data[0]).not.toHaveProperty("evals");
    expect(data[0]).not.toHaveProperty("attempts");
  });

  it("Sample 与裸 Run[] 输入同值投影(都读真实 Run.diagnostics,不依赖 Sample 的挑选过程)", async () => {
    const withDiag = snap({ experimentId: "exp/a", results: [res("q1", "passed")], diagnostics: [diag("tunnel-flaky")] });
    const scope = scopeOf([withDiag]);
    await expect(snapshotDiagnosticsData(scope)).resolves.toEqual(await snapshotDiagnosticsData(scope.runs));
  });

  it("按 experiment id 字典序排列,同一实验内按 startedAt 从新到旧;不跨来源合并", async () => {
    const b = snap({ experimentId: "exp/b", results: [res("q1", "passed")], runStartedAt: "2026-07-01T00:00:00Z", diagnostics: [diag("b1")] });
    const aOld = snap({ experimentId: "exp/a", results: [res("q1", "passed")], runStartedAt: "2026-07-01T00:00:00Z", diagnostics: [diag("a-old")] });
    const aNew = snap({ experimentId: "exp/a", results: [res("q1", "passed")], runStartedAt: "2026-07-03T00:00:00Z", diagnostics: [diag("a-new")] });
    const data = await snapshotDiagnosticsData([b, aOld, aNew]);
    expect(data.map((d) => `${d.experimentId}@${d.startedAt}`)).toEqual([
      `exp/a@${aNew.startedAt}`,
      `exp/a@${aOld.startedAt}`,
      `exp/b@${b.startedAt}`,
    ]);
    // 各条 diagnostics 只含自己来源快照的记录,不与同实验的另一条来源合并。
    expect(data.find((d) => d.startedAt === aNew.startedAt)!.diagnostics.map((r) => r.code)).toEqual(["a-new"]);
    expect(data.find((d) => d.startedAt === aOld.startedAt)!.diagnostics.map((r) => r.code)).toEqual(["a-old"]);
  });

  it("空诊断集(全部真实 Run 都没有 diagnostics):返回空数组", async () => {
    const scope = scopeOf([snap({ experimentId: "exp/a", results: [res("q1", "passed")] })]);
    await expect(snapshotDiagnosticsData(scope)).resolves.toEqual([]);
  });
});

describe("groupSnapshotDiagnostics(按来源 experiment 分组,web/text 两面共用的纯函数)", () => {
  it("按 experimentId 分组,组内保留输入序(snapshotDiagnosticsData 已排好序,这里不重排)", () => {
    const data = [
      { experimentId: "exp/a", startedAt: "2026-07-03T00:00:00Z", diagnostics: [diag("a-new")] },
      { experimentId: "exp/a", startedAt: "2026-07-01T00:00:00Z", diagnostics: [diag("a-old")] },
      { experimentId: "exp/b", startedAt: "2026-07-01T00:00:00Z", diagnostics: [diag("b1")] },
    ];
    const { groups } = groupSnapshotDiagnostics(data, "en");
    expect(groups.map((g) => g.experimentId)).toEqual(["exp/a", "exp/b"]);
    expect(groups[0]!.items.map((i) => i.startedAt)).toEqual(["2026-07-03T00:00:00Z", "2026-07-01T00:00:00Z"]);
  });

  it("summary 汇总 experiment 数、Run 数与按 count 计的记录数,并标出最高严重度", () => {
    const data = [
      { experimentId: "exp/a", startedAt: "2026-07-01T00:00:00Z", diagnostics: [diag("a1", { count: 3 }), diag("a2")] },
      { experimentId: "exp/b", startedAt: "2026-07-01T00:00:00Z", diagnostics: [diag("b1", { level: "error" })] },
    ];
    const grouped = groupSnapshotDiagnostics(data, "en");
    expect(grouped.severity).toBe("error");
    expect(grouped.summary).toBe("2 experiments · 2 runs · 5 records · errors present");
  });

  it("全部记录都是 warning 时汇总标「issues only」,不因存在记录就默认判为 error", () => {
    const data = [{ experimentId: "exp/a", startedAt: "2026-07-01T00:00:00Z", diagnostics: [diag("a1")] }];
    expect(groupSnapshotDiagnostics(data, "en").summary).toBe("1 experiment · 1 run · 1 record · issues only");
  });

  it("空诊断集:零组、空 summary", () => {
    const empty = groupSnapshotDiagnostics([], "en");
    expect(empty.groups).toEqual([]);
    expect(empty.summary).toBe("");
  });
});

// ───────────────────────── CopyFixPrompt ─────────────────────────

describe("copyFixPromptData", () => {
  const failedRes = () =>
    res("fix/failed", "failed", {
      assertions: [
        {
          name: "equals",
          severity: "gate",
          outcome: "failed" as const,
          score: 0,
          detail: "equals(42)",
          expected: "42",
          received: "41",
        },
      ] as AssertionResult[],
    });
  const erroredRes = () =>
    res("fix/errored", "errored", {
      error: { code: "sandbox-create-failed", message: "docker daemon unreachable", phase: "sandbox.create" },
    });
  const failingScope = () =>
    scopeOf([snap({ experimentId: "exp/a", results: [failedRes(), erroredRes(), res("fix/passed", "passed")] })]);

  it("两失败 fixture 的 prompt 含 eval id、主失败摘要与 attempt 下钻命令;failures 计入 failed 与 errored 两类,不计 passed", async () => {
    const scope = failingScope();
    const data = await copyFixPromptData(scope);
    expect(data.failures).toBe(2);
    expect(data.prompt).toContain('eval "fix/failed"');
    expect(data.prompt).toContain('eval "fix/errored"');
    expect(data.prompt).toContain("equals(42)");
    expect(data.prompt).toContain("docker daemon unreachable");
    expect(data.prompt).toMatch(/inspect: niceeval show @1[0-9a-z]{7}/);
  });

  it("全 passed 时 prompt 为空串、failures 为 0", async () => {
    const scope = scopeOf([snap({ experimentId: "exp/a", results: [res("q1", "passed"), res("q2", "passed")] })]);
    await expect(copyFixPromptData(scope)).resolves.toEqual({ prompt: "", failures: 0 });
  });
});

// ───────────────────────── TraceWaterfall ─────────────────────────

describe("traceWaterfallData", () => {
  const spans: TraceSpan[] = [
    // 故意乱序声明:验证按 startOffsetMs 升序
    { traceId: "t", spanId: "s2", name: "model call", startMs: 1500, endMs: 2500, kind: "model", status: "ok" },
    { traceId: "t", spanId: "s1", name: "turn 1", startMs: 1000, endMs: 3000, kind: "turn" },
    { traceId: "t", spanId: "s3", name: "tool: bash", startMs: 2600, endMs: 2900, kind: "tool", status: "error" },
    // 子 span:不进顶层摘要
    { traceId: "t", spanId: "s4", parentSpanId: "s1", name: "nested child", startMs: 1100, endMs: 1200, kind: "tool" },
  ];

  const traceScope = () =>
    scopeOf([
      snap({
        experimentId: "exp/a",
        results: [res("trace/with", "failed"), res("trace/without", "passed")],
        traces: { "trace/with": spans },
      }),
    ]);

  it("两 attempt(一含失败 span):spans 按 startOffsetMs 升序、只含顶层 span,kind 归一(turn→agent),failed 取自 status", async () => {
    const rows = await traceWaterfallData(traceScope());
    expect(rows).toHaveLength(2);
    const withTrace = rows.find((r) => r.evalId === "trace/with")!;
    expect(withTrace.durationMs).toBe(2000);
    expect(withTrace.spans.map((s) => s.name)).toEqual(["turn 1", "model call", "tool: bash"]);
    expect(withTrace.spans.map((s) => s.startOffsetMs)).toEqual([0, 500, 1600]);
    expect(withTrace.spans.map((s) => s.kind)).toEqual(["agent", "model", "tool"]);
    expect(withTrace.spans.map((s) => s.failed)).toEqual([false, false, true]);
  });

  it("缺 trace.json 的 attempt:durationMs 为 null 且行不消失、spans 为空数组,证据位置如实显示缺失", async () => {
    const rows = await traceWaterfallData(traceScope());
    const without = rows.find((r) => r.evalId === "trace/without")!;
    expect(without.durationMs).toBeNull();
    expect(without.spans).toEqual([]);
  });

  it("runner 生命周期节点不进瀑布行:span 事实只来自 trace artifact,result.phases 不被读取", async () => {
    const withPhases = res("trace/phased", "passed", {
      phases: [{ name: "sandbox.create", durationMs: 5000 }] as EvalResult["phases"],
    });
    const scope = scopeOf([snap({ experimentId: "exp/a", results: [withPhases], traces: { "trace/phased": spans } })]);
    const rows = await traceWaterfallData(scope);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.spans.map((s) => s.name)).toEqual(["turn 1", "model call", "tool: bash"]);
    expect(rows[0]!.spans.some((s) => s.name.includes("sandbox"))).toBe(false);
  });
});
