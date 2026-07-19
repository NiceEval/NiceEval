// cases: docs/engineering/unit-tests/reports/cases.md
// 站点组件的单元测试:Hero / HeroCard(标题同源、显式覆盖、手写等价、合成来源标注、空 Scope)、
// PoweredBy(品牌行 href/rel、text 面零输出)、ScopeWarnings(按动作聚合、组排序与未知 kind
// 回退、汇总行、明细折叠、下一步随行、空集零输出)、CopyFixPrompt(prompt 内容、烘进静态
// HTML、全 passed 零输出、text 面恒零输出)、TraceWaterfall(两面、缺 trace、生命周期节点
// 不进瀑布)、AttemptList filter(渐进增强不改数据)。全部用内存 fake。

import { describe, expect, it } from "vitest";

import type { AssertionResult, EvalResult, TraceSpan, Verdict } from "../types.ts";
import type { AttemptHandle, Results, Scope, ScopeWarning, Snapshot } from "../results/index.ts";
import { makeScope } from "../results/select.ts";
import {
  createTextContext,
  defineComponent,
  renderNodeToText,
  resolveReportTree,
  validateReportTree,
  ResolveMemo,
  type ReportNode,
} from "./tree.ts";
import { buildReportMeta, defineReport, pickReportPage, renderReportToText, reportTitleText } from "./report.ts";
import { renderReportToStaticHtml } from "./web.ts";
import {
  AttemptList,
  CopyFixPrompt,
  Hero,
  HeroCard,
  PoweredBy,
  ScopeWarnings,
  TraceWaterfall,
} from "./components.tsx";
import { Text } from "./primitives.tsx";
import { attemptListData, copyFixPromptData, heroData, traceWaterfallData } from "./compute.ts";

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
  name?: Snapshot["name"];
  runStartedAt?: string;
  traces?: Record<string, TraceSpan[]>;
}): Snapshot {
  runSeq += 1;
  const startedAt = spec.runStartedAt ?? `2026-06-01T00:00:00.${String(runSeq).padStart(3, "0")}Z`;
  const snapshot = {
    experimentId: spec.experimentId,
    startedAt,
    completedAt: startedAt,
    agent: "agent-x",
    name: spec.name,
    schemaVersion: 1,
    dir: `/results/exp/snap-${runSeq}`,
  } as Snapshot;
  const attempts: AttemptHandle[] = spec.results.map((r) => ({
    evalId: r.id,
    experimentId: spec.experimentId,
    result: r,
    ref: { snapshot: `exp/snap-${runSeq}`, attempt: `${r.id}/a${r.attempt}` },
    snapshot,
    events: async () => null,
    trace: async () => spec.traces?.[r.id] ?? null,
    o11y: async () => null,
    agentSetup: async () => null,
    diff: async () => null,
    sources: async () => null,
  }));
  const evals = new Map<string, AttemptHandle[]>();
  for (const attempt of attempts) evals.set(attempt.evalId, [...(evals.get(attempt.evalId) ?? []), attempt]);
  snapshot.evals = [...evals.entries()].map(([id, list]) => ({ id, attempts: list }));
  snapshot.attempts = attempts;
  return snapshot;
}

function scopeOf(snapshots: Snapshot[], warnings: ScopeWarning[] = []): Scope {
  return makeScope("current-evals", snapshots, warnings);
}

function resultsOf(snapshots: Snapshot[]): Results {
  const byId = new Map<string, Snapshot[]>();
  for (const s of snapshots) byId.set(s.experimentId, [...(byId.get(s.experimentId) ?? []), s]);
  const experiments = [...byId.entries()].map(([id, snaps]) => {
    const sorted = [...snaps].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return {
      id,
      snapshots: sorted,
      latest: sorted[0]!,
      evalIds: [...new Set(sorted.flatMap((s) => s.evals.map((e) => e.id)))].sort(),
    };
  });
  return {
    experiments,
    skipped: [],
    latest: () => makeScope("latest-snapshots", experiments.map((e) => e.latest), []),
    current: () => makeScope("current-evals", experiments.map((e) => e.latest), []),
  } as unknown as Results;
}

function hostCtx(scope: Scope) {
  return { scope, results: resultsOf(scope.snapshots) };
}

/** 站点组件测试固定"宿主已声明 attempt-input page"这条件,验证 attemptCommand/attemptHref 通道本身接得对;
 * 「没有 attempt page 时退化成纯文本」由 report.test.ts / show.test.ts 的报告级测试单独覆盖。 */
const DEFAULT_TEST_ATTEMPT_COMMAND = (locator: string) => `niceeval show ${locator}`;
const DEFAULT_TEST_ATTEMPT_HREF = (locator: string) => `#/attempt/${locator}`;

/** 管线便捷入口:装载 → resolve → validate → text 渲染(与 show 同一条管线,不带宿主前置块)。 */
async function treeText(node: ReportNode, scope: Scope, width = 120): Promise<string> {
  const definition = defineReport(node);
  const page = pickReportPage(definition);
  const resolved = await resolveReportTree(page.content, {
    scope,
    results: resultsOf(scope.snapshots),
    report: buildReportMeta(definition, scope),
    page: { id: page.id, input: "scope" },
    memo: new ResolveMemo(),
  });
  validateReportTree(resolved);
  return renderNodeToText(resolved, createTextContext({ width, attemptCommand: DEFAULT_TEST_ATTEMPT_COMMAND }));
}

/** 管线便捷入口:web 面静态 HTML(经 renderReportToStaticHtml;测试用无警告 Scope,免宿主前置块)。 */
async function treeHtml(node: ReportNode, scope: Scope): Promise<string> {
  return renderReportToStaticHtml(defineReport(node), hostCtx(scope), { attemptHref: DEFAULT_TEST_ATTEMPT_HREF });
}

// ───────────────────────── 警告 fixture(按 ScopeWarning 联合造)─────────────────────────

function partialCoverage(id: string): ScopeWarning {
  return {
    kind: "partial-coverage",
    experimentId: id,
    covered: 4,
    total: 6,
    message: `snapshot "${id}" covers 4 of 6 known evals; re-run \`niceeval exp ${id}\` to fill the gap`,
    command: `niceeval exp ${id}`,
  };
}

function staleSnapshot(id: string): ScopeWarning {
  return {
    kind: "stale-snapshot",
    experimentId: id,
    startedAt: "2026-07-10T00:00:00Z",
    latestStartedAt: "2026-07-12T00:00:00Z",
    message: `verdicts for "${id}" were produced at 2026-07-10T00:00:00Z, 2 days before the latest run in this scope; re-run \`niceeval exp ${id}\` to align, or ignore if evals, agent and model are unchanged between the runs`,
    command: `niceeval exp ${id}`,
  };
}

function unfinishedSnapshot(id: string): ScopeWarning {
  return {
    kind: "unfinished-snapshot",
    experimentId: id,
    startedAt: "2026-07-11T00:00:00Z",
    dir: `/results/${id}`,
    message: `snapshot "${id}" (2026-07-11T00:00:00Z) is unfinished (the process was interrupted); completed attempts are read as-is, but the set may be incomplete — re-run \`niceeval exp ${id}\` for a complete snapshot`,
    command: `niceeval exp ${id}`,
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

  it("声明 title 后 <Hero /> 两面输出含该标题,且与浏览器标题(回退链)同源", async () => {
    const scope = heroScope();
    const definition = defineReport({ title: { en: "Memory Evals" }, content: <Hero /> });
    const browserTitle = reportTitleText(definition, scope, "en");
    expect(browserTitle).toBe("Memory Evals");
    const text = await renderReportToText(definition, hostCtx(scope));
    const html = await renderReportToStaticHtml(definition, hostCtx(scope));
    expect(text).toContain("Memory Evals");
    expect(html).toContain("<h1");
    expect(html).toContain("Memory Evals");
  });

  it("显式 title prop 覆盖站点声明", async () => {
    const scope = heroScope();
    const definition = defineReport({ title: "Declared Title", content: <Hero title="Custom Hero" /> });
    const text = await renderReportToText(definition, hostCtx(scope));
    const html = await renderReportToStaticHtml(definition, hostCtx(scope));
    expect(text).toContain("Custom Hero");
    expect(text).not.toContain("Declared Title");
    expect(html).toContain("Custom Hero");
  });

  it("<Hero /> 与手写 <HeroCard title={ctx.report.title} data={await heroData(ctx.scope)} /> 严格等价", async () => {
    const scope = heroScope();
    const Handwritten = defineComponent(async (_props: Record<never, never>, ctx) => (
      <HeroCard title={ctx.report.title} data={await heroData(ctx.scope)} />
    ));
    const [heroText, handText] = [await treeText(<Hero />, scope), await treeText(<Handwritten />, scope)];
    expect(heroText).toBe(handText);
    const [heroHtml, handHtml] = [await treeHtml(<Hero />, scope), await treeHtml(<Handwritten />, scope)];
    expect(heroHtml).toBe(handHtml);
  });

  it("heroData:latestStartedAt 取范围内最新快照开始时间、snapshots 计贡献快照数;web 面标注合成来源", async () => {
    const scope = heroScope();
    const data = await heroData(scope);
    expect(data.latestStartedAt).toBe("2026-07-03T10:00:00Z");
    expect(data.snapshots).toBe(3);
    const html = await treeHtml(<HeroCard title="T" data={data} />, scope);
    expect(html).toContain("composed from 3 runs");
    // text 面的合成来源标注(show 页首 meta 行)
    const text = await treeText(<HeroCard title="T" data={data} />, scope);
    expect(text).toContain("composed from 3 snapshots");
  });

  it("空 Scope:latestStartedAt 为 null,两面显示内置「暂无运行」文案,不编造当前时间", async () => {
    const empty = scopeOf([]);
    const data = await heroData(empty);
    expect(data).toEqual({ latestStartedAt: null, snapshots: 0 });
    const html = await treeHtml(<HeroCard title="T" data={data} />, empty);
    expect(html).toContain("No runs yet");
    const text = await treeText(<HeroCard title="T" data={data} />, empty);
    expect(text).toContain("No runs yet");
    expect(text).not.toContain("202"); // 没有任何编造的时间
  });
});

// ───────────────────────── 品牌组件 ─────────────────────────

describe("品牌是组件(PoweredBy / HeroCard 品牌行)", () => {
  const scope = () => scopeOf([snap({ experimentId: "exp/a", results: [res("q1", "passed")] })]);

  it("PoweredBy web 面渲染官网品牌行:href 含 utm_source=report&utm_medium=powered-by,rel 仅 noopener", async () => {
    const html = await treeHtml(<PoweredBy />, scope());
    expect(html).toContain("Powered by NiceEval");
    expect(html).toContain("https://niceeval.com/?utm_source=report&amp;utm_medium=powered-by");
    expect(html).toContain('rel="noopener"');
    expect(html).not.toContain("noreferrer");
  });

  it("PoweredBy text 面零输出;HeroCard web 面恒含品牌行、text 面不含", async () => {
    const s = scope();
    expect(await treeText(<PoweredBy />, s)).toBe("");
    const data = await heroData(s);
    const html = await treeHtml(<HeroCard title="T" data={data} />, s);
    expect(html).toContain("nre-powered-by");
    expect(html).toContain("Powered by NiceEval");
    const text = await treeText(<HeroCard title="T" data={data} />, s);
    expect(text).not.toContain("Powered by");
  });
});

// ───────────────────────── ScopeWarnings ─────────────────────────

describe("ScopeWarnings(按动作聚合)", () => {
  const plainScope = () => scopeOf([snap({ experimentId: "exp/a", results: [res("q1", "passed")] })]);

  it("同 experimentId 的多 kind 聚合为一组:组头含实验 id、两枚徽标与去重后恰一条命令;不同实验不进同一组", async () => {
    const warnings = [partialCoverage("exp/a"), staleSnapshot("exp/a"), partialCoverage("exp/b")];
    const html = await treeHtml(<ScopeWarnings data={warnings} />, plainScope());
    expect(html.match(/class="nre-warning-group"/g)?.length).toBe(2);
    // exp/a 组:coverage 徽标 + gap 徽标齐全
    expect(html).toContain("coverage 4/6");
    expect(html).toContain("2 days behind");
    // 组头命令去重后恰一条(exp/a 的两条警告命令相同)
    expect(html.match(/data-nre-copy="niceeval exp exp\/a"/g)?.length).toBe(1);
    expect(html.match(/data-nre-copy="niceeval exp exp\/b"/g)?.length).toBe(1);
  });

  it("组排序:integrity 组在 freshness 组之前,混合组按最重成员归位;未知 kind 单独成组、message 原样、按 integrity 归位", async () => {
    const unknown = {
      kind: "future-kind",
      message: "something new happened; check the docs for future-kind",
    } as unknown as ScopeWarning;
    // 声明顺序故意把 freshness(仅 stale 的实验)放最前
    const warnings = [staleSnapshot("exp/fresh"), partialCoverage("exp/int"), unknown];
    const html = await treeHtml(<ScopeWarnings data={warnings} />, plainScope());
    const posInt = html.indexOf("exp/int");
    const posUnknown = html.indexOf("future-kind");
    const posFresh = html.indexOf("exp/fresh");
    expect(posInt).toBeGreaterThan(-1);
    expect(posUnknown).toBeGreaterThan(-1);
    // integrity(exp/int 与未知 kind)都排在仅 stale 的 freshness 组之前
    expect(posInt).toBeLessThan(posFresh);
    expect(posUnknown).toBeLessThan(posFresh);
    // 未知 kind 的 message 完整可见
    expect(html).toContain("something new happened; check the docs for future-kind");
  });

  it("web 面整个警告区默认折叠:外层 <details> 无 open,<summary> 是分类计数汇总行且任何组数下都渲染;text 面单组无汇总行", async () => {
    const two = await treeHtml(<ScopeWarnings data={[partialCoverage("exp/a"), staleSnapshot("exp/b")]} />, plainScope());
    expect(two).toContain('<details class="nre-warnings">');
    expect(two).toContain('<summary class="nre-warnings-summary">2 experiments flagged</summary>');
    const one = await treeHtml(<ScopeWarnings data={[partialCoverage("exp/a")]} />, plainScope());
    expect(one).toContain('<details class="nre-warnings">');
    expect(one).toContain('<summary class="nre-warnings-summary">1 experiment flagged</summary>');
    // text 面汇总行只在多组时输出:单组首行即组头
    const oneText = await treeText(<ScopeWarnings data={[partialCoverage("exp/a")]} />, plainScope(), 200);
    expect(oneText.split("\n")[0]).toContain("exp/a");
    expect(oneText).not.toContain("experiment flagged");
  });

  it("明细折叠:web 面组级 <details> 在总条数 ≤ 3 时默认展开、4 条时不展开,外层恒无 open;text 面不折叠,组头一行 + 缩进逐条 message 以下一步收尾", async () => {
    const three = [partialCoverage("exp/a"), staleSnapshot("exp/a"), partialCoverage("exp/b")];
    const four = [...three, unfinishedSnapshot("exp/b")];
    const htmlThree = await treeHtml(<ScopeWarnings data={three} />, plainScope());
    const htmlFour = await treeHtml(<ScopeWarnings data={four} />, plainScope());
    // 外层警告区两种条数下都默认折叠
    expect(htmlThree).toContain('<details class="nre-warnings">');
    expect(htmlFour).toContain('<details class="nre-warnings">');
    expect(htmlThree).toMatch(/class="nre-warning-details"[^>]*\sopen/);
    expect(htmlFour).not.toMatch(/<details[^>]*\sopen/);

    const text = await treeText(<ScopeWarnings data={[partialCoverage("exp/a"), staleSnapshot("exp/a")]} />, plainScope(), 200);
    const lines = text.split("\n");
    // 组头一行:标题 + 徽标 + 组头命令
    expect(lines[0]).toContain("exp/a");
    expect(lines[0]).toContain("coverage 4/6");
    expect(lines[0]).toContain("niceeval exp exp/a");
    // 明细缩进逐条原样打印,不截断掉尾段(stale 的 message 以忽略条件收尾)
    expect(lines.some((line) => line.startsWith("!   ") && line.endsWith("to fill the gap"))).toBe(true);
    expect(lines.some((line) => line.startsWith("!   ") && line.endsWith("unchanged between the runs"))).toBe(true);
  });

  it("下一步随行:带 command 的条目在 web 面可复制,无 command 的不硬造动作;空集与裸 Snapshot[] 输入两面零输出", async () => {
    const scope = plainScope();
    const staleHtml = await treeHtml(<ScopeWarnings data={[staleSnapshot("exp/a")]} />, scope);
    expect(staleHtml).toContain('data-nre-copy="niceeval exp exp/a"');
    // missing-startedAt 形态(无 command)的条目:message 可见、无复制动作
    const noCommand = {
      kind: "missing-startedAt",
      experimentId: "exp/a",
      evalId: "q1",
      message: "attempt identity for exp/a q1 lacks startedAt; check the writer that produced it",
    } as unknown as ScopeWarning;
    const noCommandHtml = await treeHtml(<ScopeWarnings data={[noCommand]} />, scope);
    expect(noCommandHtml).toContain("lacks startedAt");
    expect(noCommandHtml).not.toContain("data-nre-copy");
    expect(noCommandHtml).not.toContain("nre-warning-command");
    // 空警告集:两面零输出,不渲染空容器
    expect(await treeHtml(<ScopeWarnings data={[]} />, scope)).toBe("");
    expect(await treeText(<ScopeWarnings data={[]} />, scope)).toBe("");
    // 裸 Snapshot[] 输入:没有挑选过程、没有警告,渲染为空
    expect(await treeHtml(<ScopeWarnings input={scope.snapshots} />, scope)).toBe("");
    expect(await treeText(<ScopeWarnings input={scope.snapshots} />, scope)).toBe("");
  });
});

// ───────────────────────── CopyFixPrompt ─────────────────────────

describe("CopyFixPrompt", () => {
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

  it("两失败 fixture 的 prompt 含 eval id、主失败摘要与 attempt 下钻命令,并在 resolve 期烘进静态 HTML(无 JS 折叠块完整可读)", async () => {
    const scope = failingScope();
    const data = await copyFixPromptData(scope);
    expect(data.failures).toBe(2);
    expect(data.prompt).toContain('eval "fix/failed"');
    expect(data.prompt).toContain('eval "fix/errored"');
    expect(data.prompt).toContain("equals(42)");
    expect(data.prompt).toContain("docker daemon unreachable");
    expect(data.prompt).toMatch(/inspect: niceeval show @1[0-9a-z]{7}/);
    // spec 形态经管线烘进静态 HTML:prompt 全文在折叠块里,复制走增强层(data-nre-copy)
    const html = await treeHtml(<CopyFixPrompt />, scope);
    expect(html).toContain("<details");
    expect(html).toContain("equals(42)");
    expect(html).toContain("Fix the failing evals from this niceeval run.");
    expect(html).toContain("data-nre-copy");
  });

  it("全 passed 时两面零输出,不渲染任何节点", async () => {
    const scope = scopeOf([snap({ experimentId: "exp/a", results: [res("q1", "passed"), res("q2", "passed")] })]);
    expect(await treeHtml(<CopyFixPrompt />, scope)).toBe("");
    expect(await treeText(<CopyFixPrompt />, scope)).toBe("");
  });

  it("text 面恒零输出:show 输出不含 prompt 文本", async () => {
    const scope = failingScope();
    const definition = defineReport(
      <>
        <CopyFixPrompt />
        <Text>after-prompt-marker</Text>
      </>,
    );
    const text = await renderReportToText(definition, hostCtx(scope));
    expect(text).toContain("after-prompt-marker");
    expect(text).not.toContain("Fix the failing evals");
    expect(text).not.toContain("inspect:");
  });
});

// ───────────────────────── TraceWaterfall ─────────────────────────

describe("TraceWaterfall", () => {
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

  it("两 attempt(一含失败 span)两面各自正确,spans 按 startOffsetMs 升序、只含顶层 span", async () => {
    const scope = traceScope();
    const rows = await traceWaterfallData(scope);
    expect(rows).toHaveLength(2);
    const withTrace = rows.find((r) => r.evalId === "trace/with")!;
    expect(withTrace.durationMs).toBe(2000);
    expect(withTrace.spans.map((s) => s.name)).toEqual(["turn 1", "model call", "tool: bash"]);
    expect(withTrace.spans.map((s) => s.startOffsetMs)).toEqual([0, 500, 1600]);
    expect(withTrace.spans.map((s) => s.kind)).toEqual(["agent", "model", "tool"]);
    expect(withTrace.spans.map((s) => s.failed)).toEqual([false, false, true]);

    const html = await treeHtml(<TraceWaterfall />, scope);
    expect(html.match(/nre-waterfall-row/g)?.length).toBe(2);
    expect(html).toContain("nre-span-failed");
    expect(html).toContain(`href="#/attempt/${withTrace.locator}"`);

    const text = await treeText(<TraceWaterfall />, scope, 200);
    const lines = text.split("\n");
    expect(lines).toHaveLength(2);
    const withLine = lines.find((line) => line.includes("trace/with"))!;
    expect(withLine).toContain(withTrace.locator);
    expect(withLine).toContain("2.0s");
    expect(withLine).toContain("3 spans");
    expect(withLine).toContain("✗ 1 failed");
    expect(withLine).toContain(`niceeval show ${withTrace.locator} --timing`);
  });

  it("缺 trace.json 的 attempt:durationMs 为 null 且行不消失,证据位置如实显示缺失", async () => {
    const scope = traceScope();
    const rows = await traceWaterfallData(scope);
    const without = rows.find((r) => r.evalId === "trace/without")!;
    expect(without.durationMs).toBeNull();
    expect(without.spans).toEqual([]);
    const text = await treeText(<TraceWaterfall />, scope, 200);
    const line = text.split("\n").find((l) => l.includes("trace/without"))!;
    expect(line).toContain("no trace");
    expect(line).toContain(`niceeval show ${without.locator} --timing`);
    const html = await treeHtml(<TraceWaterfall />, scope);
    expect(html).toContain("no trace");
  });

  it("runner 生命周期节点不进瀑布行:span 事实只来自 trace artifact,phases 不被读取", async () => {
    const withPhases = res("trace/phased", "passed", {
      phases: [{ name: "sandbox.create", durationMs: 5000 }] as EvalResult["phases"],
    });
    const scope = scopeOf([
      snap({ experimentId: "exp/a", results: [withPhases], traces: { "trace/phased": spans } }),
    ]);
    const rows = await traceWaterfallData(scope);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.spans.map((s) => s.name)).toEqual(["turn 1", "model call", "tool: bash"]);
    expect(rows[0]!.spans.some((s) => s.name.includes("sandbox"))).toBe(false);
    const html = await treeHtml(<TraceWaterfall />, scope);
    expect(html).not.toContain("sandbox.create");
  });
});

// ───────────────────────── AttemptList filter ─────────────────────────

describe("AttemptList 的 filter 渐进增强", () => {
  it("有无 filter 时初始行集合与 text 输出相同:filter 只加过滤框,不改变数据与 text 面", async () => {
    const scope = scopeOf([
      snap({
        experimentId: "exp/a",
        results: [res("q1", "passed"), res("q2", "failed"), res("q3", "errored", { error: { code: "x", message: "boom", phase: "eval.run" } })],
      }),
    ]);
    const items = await attemptListData(scope);
    const plain = await treeHtml(<AttemptList data={items} />, scope);
    const filtered = await treeHtml(<AttemptList data={items} filter />, scope);
    // 过滤框是唯一差异;去掉它后行集合与初始 HTML 完全相同
    expect(filtered).toContain("data-nre-attempt-filter");
    expect(filtered.replace(/<input[^>]*data-nre-attempt-filter[^>]*>/, "")).toBe(plain);
    expect(plain.match(/class="nre-attempt /g)?.length).toBe(3);

    const textPlain = await treeText(<AttemptList data={items} />, scope, 160);
    const textFiltered = await treeText(<AttemptList data={items} filter />, scope, 160);
    expect(textFiltered).toBe(textPlain);
  });
});
