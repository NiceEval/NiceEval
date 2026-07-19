// cases: docs/engineering/unit-tests/reports/cases.md
// 管线与双面渲染的单元测试:resolve(spec/data 双形态、记忆化、组合组件、同层并行保序、
// 非法节点拒绝)、validate(裸字符串、单面组件、Tabs 配对)、装载规范化(defineReport 三种
// 写法、content/pages 互斥、外壳嵌套、page id、标题回退)、text/web 双面同源、
// Table 与文本排版原语、FailureList 等价、内建报告等价。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { EvalResult, Verdict } from "../types.ts";
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
import {
  buildReportMeta,
  defineReport,
  FALLBACK_REPORT_TITLE,
  pickReportPage,
  renderReportToText,
  ReportPageNeedsLocatorError,
  ReportPageNotFoundError,
  resolveReportTitle,
} from "./report.ts";
import { renderReportToStaticHtml } from "./web.ts";
import {
  AttemptList,
  CopyFixPrompt,
  ExperimentComparison,
  ExperimentList,
  FailureList,
  Hero,
  MetricBars,
  MetricMatrix,
  MetricScatter,
  MetricTable,
  ScopeSummary,
  ScopeWarnings,
  TraceWaterfall,
} from "./components.tsx";
import { Col, Row, Section, Style, Tab, Table, Tabs, Text } from "./primitives.tsx";
import { attemptListData, metricScatterData } from "./compute.ts";
import { costUSD, defineMetric, endToEndPassRate } from "./metrics.ts";
import builtInReport, { standard } from "./built-in/index.tsx";

// ───────────────────────── fake 数据 ─────────────────────────

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

function snap(spec: {
  experimentId: string;
  results: EvalResult[];
  agent?: string;
  model?: string;
  name?: Snapshot["name"];
  runStartedAt?: string;
}): Snapshot {
  runSeq += 1;
  const startedAt = spec.runStartedAt ?? `2026-06-01T00:00:00.${String(runSeq).padStart(3, "0")}Z`;
  const snapshot = {
    experimentId: spec.experimentId,
    startedAt,
    completedAt: startedAt,
    agent: spec.agent ?? "agent-x",
    model: spec.model,
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
    trace: async () => null,
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

/** 管线便捷入口:resolve + validate + text 渲染,报告声明用最小 meta。 */
async function renderTreeText(node: ReportNode, scope: Scope, width = 100): Promise<string> {
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
  return renderNodeToText(resolved, createTextContext({ width }));
}

// ───────────────────────── spec / data 双形态 ─────────────────────────

describe("spec 形态与 data 形态", () => {
  const scatterScope = () =>
    scopeOf([
      snap({
        experimentId: "cmp/a",
        agent: "bub",
        results: [res("q", "passed", { usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.2 } })],
      }),
      snap({
        experimentId: "cmp/b",
        agent: "codex",
        results: [res("q", "failed", { usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.1 } })],
      }),
    ]);

  it("spec 形态与「先手工调 *Data 再传 data」严格等价:两棵树渲染深等", async () => {
    const scope = scatterScope();
    const options = { points: "experiment", series: "agent", x: costUSD, y: endToEndPassRate } as const;
    const specText = await renderTreeText(
      <MetricScatter points="experiment" series="agent" x={costUSD} y={endToEndPassRate} />,
      scope,
    );
    const data = await metricScatterData(scope, options);
    const dataText = await renderTreeText(<MetricScatter data={data} />, scope);
    expect(specText).toBe(dataText);
  });

  it("同一组件同时给 data 与 spec 字段报完整用户反馈,不静默取一边", async () => {
    const scope = scatterScope();
    const data = await metricScatterData(scope, { points: "experiment", x: costUSD, y: endToEndPassRate });
    await expect(
      renderTreeText(
        // @ts-expect-error data 与 spec 字段互斥,类型层已拒绝;这里模拟无类型 JS 输入
        <MetricScatter data={data} points="experiment" x={costUSD} y={endToEndPassRate} />,
        scope,
      ),
    ).rejects.toThrow(/both `data` and spec/);
  });

  it("input 省略时取宿主注入的 Scope;显式 input 覆盖数据来源", async () => {
    const a = snap({ experimentId: "in/a", results: [res("q", "passed")] });
    const b = snap({ experimentId: "in/b", results: [res("q", "failed")] });
    const scope = scopeOf([a, b]);
    const all = await renderTreeText(<ScopeSummary />, scope);
    expect(all).toContain("2 experiments");
    const narrowed = await renderTreeText(
      <ScopeSummary input={scope.filter((s) => s.experimentId === "in/a")} />,
      scope,
    );
    expect(narrowed).toContain("1 experiment ·");
    // input 也可以是手挑的 Snapshot[](按快照出行)
    const snapshotsOnly = await renderTreeText(
      <MetricTable input={[a]} rows="snapshot" columns={[endToEndPassRate]} />,
      scope,
      140,
    );
    expect(snapshotsOnly).toContain("in/a @");
    expect(snapshotsOnly).not.toContain("in/b");
  });

  it("data 结构校验:字段改名前的旧 JSON 报错且文案含版本漂移提示;round-trip 的同版本 JSON 照常渲染", async () => {
    const scope = scatterScope();
    const table = { dimension: "agent", columns: [], rows: [] }; // 旧形状:dimension 而非 rowDimension
    await expect(renderTreeText(<MetricTable data={table as never} />, scope)).rejects.toThrow(
      /does not match the current TableData shape[\s\S]*different niceeval version/,
    );

    const fresh = await metricScatterData(scope, { points: "experiment", x: costUSD, y: endToEndPassRate });
    const roundTrip = JSON.parse(JSON.stringify(fresh));
    const html = renderToStaticMarkup(<MetricScatter data={roundTrip} />);
    expect(html).toContain("nre-metric-scatter");
  });

  it("text 面散点轴方向跟随 better:成本轴反向(便宜在右)、提示恒为右上;x 无 better 时整图无提示", async () => {
    // cmp/a:cost $0.20、通过;cmp/b:cost $0.10、失败。cost better:"lower" → 轴反向,
    // 便宜的 cmp/b(标记 B)落在贵的 cmp/a(标记 A)右侧;刻度仍显示真实值(右端是更小的 $0.10)。
    const scope = scatterScope();
    const text = await renderTreeText(
      <MetricScatter points="experiment" x={costUSD} y={endToEndPassRate} />,
      scope,
    );
    const markCol = (mark: string): number => {
      const line = text.split("\n").find((l) => l.includes(mark));
      expect(line, `plot row with mark ${mark}`).toBeTruthy();
      return line!.indexOf(mark);
    };
    expect(markCol("B")).toBeGreaterThan(markCol("A"));
    expect(text).toContain("better → upper right");
    expect(text).toContain("$0.10");
    expect(text).toContain("$0.20");

    // x 未声明 better:轴正向、整图无方向提示(组件不猜「更好」朝哪边)。
    const rawCost = defineMetric({
      name: "rawCost",
      unit: "$",
      value: (attempt) => attempt.result.usage?.costUSD ?? null,
    });
    const noHint = await renderTreeText(
      <MetricScatter points="experiment" x={rawCost} y={endToEndPassRate} />,
      scope,
    );
    expect(noHint).not.toContain("better →");
    // 正向轴:贵的 cmp/a(A)在右。
    const noHintCol = (mark: string): number => {
      const line = noHint.split("\n").find((l) => l.includes(mark));
      expect(line, `plot row with mark ${mark}`).toBeTruthy();
      return line!.indexOf(mark);
    };
    expect(noHintCol("A")).toBeGreaterThan(noHintCol("B"));
  });
});

// ───────────────────────── resolve 记忆化 ─────────────────────────

describe("resolve 记忆化", () => {
  it("Matrix 与 Bars 同 spec 时计算只发生一次;不同 spec 各自计算", async () => {
    let calls = 0;
    const counted = defineMetric({
      name: "counted",
      value: () => {
        calls += 1;
        return 1;
      },
    });
    const scope = scopeOf([snap({ experimentId: "memo/a", results: [res("q", "passed")] })]);
    await renderTreeText(
      <Col>
        <MetricMatrix rows="eval" columns="agent" cell={counted} />
        <MetricBars rows="eval" columns="agent" cell={counted} />
      </Col>,
      scope,
    );
    expect(calls).toBe(1); // 一个 attempt,矩阵只算一遍

    calls = 0;
    await renderTreeText(
      <Col>
        <MetricMatrix rows="eval" columns="agent" cell={counted} />
        <MetricMatrix rows="eval" columns="model" cell={counted} />
      </Col>,
      scope,
    );
    expect(calls).toBe(2); // spec 不同(columns 维度不同):各自计算
  });

  it("不同 input 各自计算;字段相同但实例不同的 Metric 各自计算、不报错", async () => {
    let calls = 0;
    const value = () => {
      calls += 1;
      return 1;
    };
    const m1 = defineMetric({ name: "twin", value });
    const m2 = defineMetric({ name: "twin", value: (attempt) => value.call(null) }); // 引用不同的等价定义
    const a = snap({ experimentId: "memo/in-a", results: [res("q", "passed")] });
    const b = snap({ experimentId: "memo/in-b", results: [res("q", "passed")] });
    const scope = scopeOf([a, b]);
    await renderTreeText(
      <Col>
        <MetricMatrix input={[a]} rows="eval" columns="agent" cell={m1} />
        <MetricMatrix input={[b]} rows="eval" columns="agent" cell={m1} />
        <MetricMatrix input={[a]} rows="eval" columns="agent" cell={m2} />
      </Col>,
      scope,
    );
    expect(calls).toBe(3); // 两个 input 各一次 + 不同实例的 Metric 再一次
  });
});

// ───────────────────────── 组合组件与树形状 ─────────────────────────

describe("组合组件(函数形态)", () => {
  it("resolve 阶段以 (props, ctx) 调用并递归展开;与手写等价树渲染相同;async 可用", async () => {
    const scope = scopeOf([snap({ experimentId: "compose/a", results: [res("q", "passed")] })]);
    const Composed = defineComponent(async (_props: Record<never, never>, ctx) => (
      <Section title="wrapped">
        <ScopeSummary input={ctx.scope} />
      </Section>
    ));
    const composed = await renderTreeText(<Composed />, scope);
    const manual = await renderTreeText(
      <Section title="wrapped">
        <ScopeSummary />
      </Section>,
      scope,
    );
    expect(composed).toBe(manual);
  });

  it("ctx.results 可自行挑 Snapshot[] 喂 input;ctx.report 携带走完回退链的 title,ctx.page 携带当前页 id", async () => {
    const named = snap({ experimentId: "hist/a", name: "Memory Evals", results: [res("q", "passed")] });
    const scope = scopeOf([named]);
    const Meta = defineComponent((_props: Record<never, never>, ctx) => {
      const history = ctx.results.experiments[0]!.snapshots;
      return (
        <Col>
          <Text>{`title=${typeof ctx.report.title === "string" ? ctx.report.title : "?"} page=${ctx.page.id}`}</Text>
          <ScopeSummary input={history} />
        </Col>
      );
    });
    const definition = defineReport({ pages: [{ id: "meta", title: "Meta", content: <Meta /> }] });
    const text = await renderReportToText(definition, { scope, results: resultsOf([named]) }, { pageId: "meta" });
    // 声明没给 title → 唯一快照 name 回退
    expect(text).toContain("title=Memory Evals page=meta");
  });

  it("同层 sibling 并行取数且输出保持声明顺序:慢 resolve 在前不换位", async () => {
    const order: string[] = [];
    const Slow = defineComponent<{ label: string }, { label: string }>({
      resolve: async (props) => {
        await new Promise((r) => setTimeout(r, 25));
        order.push("slow-resolved");
        return props;
      },
      web: ({ label }) => <p>{label}</p>,
      text: ({ label }) => label,
    });
    const Fast = defineComponent<{ label: string }, { label: string }>({
      resolve: (props) => {
        order.push("fast-resolved");
        return props;
      },
      web: ({ label }) => <p>{label}</p>,
      text: ({ label }) => label,
    });
    const scope = scopeOf([]);
    const text = await renderTreeText(
      <Col>
        <Slow label="first" />
        <Fast label="second" />
      </Col>,
      scope,
    );
    expect(order[0]).toBe("fast-resolved"); // 真并行:快的先完成
    expect(text.indexOf("first")).toBeLessThan(text.indexOf("second")); // 输出仍按声明序
  });
});

describe("ReportNode 形状与非法节点", () => {
  const scope = () => scopeOf([snap({ experimentId: "node/a", results: [res("q", "passed")] })]);

  it("数组 / Fragment 展平保序;null / undefined / boolean 渲染为空", async () => {
    const groups = ["g1", "g2"];
    const text = await renderTreeText(
      <Col>
        {groups.map((g) => (
          <Section key={g} title={g}>
            <Text>{`body of ${g}`}</Text>
          </Section>
        ))}
        <>
          <Text>in fragment</Text>
        </>
        {false && <Text>hidden</Text>}
        {null}
      </Col>,
      scope(),
    );
    expect(text.indexOf("g1")).toBeLessThan(text.indexOf("g2"));
    expect(text).toContain("in fragment");
    expect(text).not.toContain("hidden");
  });

  it("裸字符串在树校验时按完整用户反馈拒绝并指引包 <Text>", async () => {
    await expect(renderTreeText(<Col>{"free text" as unknown as ReportNode}</Col>, scope())).rejects.toThrow(
      /bare string[\s\S]*<Text>/,
    );
  });

  it("React 组件 / 未包装函数与 HTML intrinsic 在展开遇到时拒绝", async () => {
    const Plain = ({ label }: { label: string }) => <p>{label}</p>;
    await expect(renderTreeText(<Plain label="x" />, scope())).rejects.toThrow(
      /not a report component[\s\S]*defineComponent/,
    );
    await expect(renderTreeText(<div>x</div>, scope())).rejects.toThrow(/raw HTML <div>/);
  });

  it("validateReportTree 拒绝缺任一渲染面的组件(无类型 JS 绕过 defineComponent 时)", () => {
    const single = Object.assign(() => null, {
      [Symbol.for("niceeval.report.faces")]: { web: () => null }, // 缺 text 面
    });
    expect(() => validateReportTree({ type: single, props: {} })).toThrow(/missing its text face/);
    expect(() => validateReportTree({ type: "div", props: {} })).toThrow(/raw HTML <div>/);
  });

  it("defineComponent 对象形态缺 text 或 web 在定义时报完整用户反馈", () => {
    expect(() => defineComponent({ web: () => null } as never)).toThrow(/both faces/);
  });
});

// ───────────────────────── 双面同源 ─────────────────────────

describe("text/web 双面同源", () => {
  it("双面显示同一份解析终值、覆盖率与 warning;警告的呈现件是页内 ScopeWarnings 组件,宿主无树外通道", async () => {
    const s = snap({ experimentId: "dual/a", results: [res("q1", "passed"), res("q2", "skipped")] });
    const warning: ScopeWarning = {
      kind: "unfinished-snapshot",
      experimentId: "dual/a",
      startedAt: s.startedAt,
      dir: s.dir,
      message: "snapshot is incomplete",
      command: "niceeval exp dual/a",
    };
    const scope = scopeOf([s], [warning]);
    const definition = defineReport(
      <Col>
        <ScopeWarnings />
        <ScopeSummary />
      </Col>,
    );
    const ctx = { scope, results: resultsOf([s]) };
    const text = await renderReportToText(definition, ctx);
    const html = await renderReportToStaticHtml(definition, ctx);
    for (const face of [text, html]) {
      expect(face).toContain("100%"); // endToEndPassRate:skipped 不稀释
      expect(face).toContain("1/2"); // samples/total 覆盖率
      expect(face).toContain("snapshot is incomplete");
    }
    // web 面把警告的 command 渲染为可复制命令
    expect(html).toContain("niceeval exp dual/a");
    expect(html).toContain("nre-warning-command");
    // 宿主不再前置树外警告块:没有 ScopeWarnings 的树两面都不出现警告
    const bare = defineReport(<ScopeSummary />);
    expect(await renderReportToText(bare, ctx)).not.toContain("snapshot is incomplete");
    expect(await renderReportToStaticHtml(bare, ctx)).not.toContain("nre-warning");
  });

  it("web 排序/过滤只改变浏览状态:有无 filter prop 数值与行集合相同", async () => {
    const scope = scopeOf([snap({ experimentId: "f/a", results: [res("q", "passed")] })]);
    const definition = (filter: boolean) =>
      defineReport(<MetricTable rows="experiment" columns={[endToEndPassRate]} filter={filter} />);
    const ctx = { scope, results: resultsOf(scope.snapshots) };
    const plain = await renderReportToStaticHtml(definition(false), ctx);
    const filtered = await renderReportToStaticHtml(definition(true), ctx);
    const values = (html: string) => html.match(/data-sort-value="[^"]*"/g);
    expect(values(filtered)).toEqual(values(plain));
  });

  it("ExperimentList text 面保持实体层级:一题两 attempt 只出现一次 Eval 标题;失败摘要只在 Attempt 子行", async () => {
    const s = snap({
      experimentId: "grp/exp-a",
      results: [
        res("algebra/retry", "failed", {
          attempt: 0,
          assertions: [
            {
              name: "equals",
              severity: "gate",
              outcome: "failed",
              score: 0,
              detail: "equals(42)",
              expected: "42",
              received: "41",
            },
          ],
        }),
        res("algebra/retry", "passed", { attempt: 1 }),
      ],
    });
    const text = await renderTreeText(<ExperimentList relativeTo="grp" />, scopeOf([s]), 160);
    expect(text.match(/algebra\/retry/g)).toHaveLength(1); // Eval 父行只出现一次
    expect(text).toContain("├─");
    expect(text).toContain("└─");
    // 失败摘要只在 Attempt 子行(父行不复述)
    expect(text.match(/equals\(42\)/g)).toHaveLength(1);
    // relativeTo:行标签只显示末段
    expect(text).toContain("exp-a");
  });
});

// ScopeWarnings 的聚合、排序、折叠与下一步行为在 site-components.test.tsx(组件版单源);
// 宿主不再有树外警告前置块,这里不重复宿主版。

// ───────────────────────── FailureList ─────────────────────────

describe("FailureList", () => {
  it("与手写组合严格等价:failed/errored、开始时间降序、limit 截断且 total 报截断前总数", async () => {
    const s = snap({
      experimentId: "fail/a",
      results: [
        res("q1", "failed", { startedAt: "2026-07-01T01:00:00.000Z" }),
        res("q2", "errored", {
          startedAt: "2026-07-01T03:00:00.000Z",
          error: { code: "x", message: "boom", phase: "eval.run" },
        }),
        res("q3", "failed", { startedAt: "2026-07-01T02:00:00.000Z" }),
        res("q4", "passed", { startedAt: "2026-07-01T04:00:00.000Z" }),
      ],
    });
    const scope = scopeOf([s]);
    const failureText = await renderTreeText(<FailureList limit={2} />, scope);

    // 手写组合:attemptListData → 过滤 → 排序 → AttemptList data 形态
    const all = await attemptListData(scope);
    const startedAt = new Map(s.attempts.map((a) => [a.evalId, a.result.startedAt ?? ""]));
    const failures = all
      .filter((x) => x.verdict === "failed" || x.verdict === "errored")
      .sort((a, b) => (startedAt.get(b.evalId) ?? "").localeCompare(startedAt.get(a.evalId) ?? ""));
    const manualText = await renderTreeText(<AttemptList data={failures.slice(0, 2)} total={failures.length} />, scope);
    expect(failureText).toBe(manualText);
    expect(failureText).toContain("(1 more not shown)"); // 3 条失败,截断到 2
    // 最近的失败在前
    expect(failureText.indexOf("q2")).toBeLessThan(failureText.indexOf("q3"));
    expect(failureText).not.toContain("q4"); // passed 不进失败清单
  });

  it("失败数少于 limit 时 total 等于 data 长度,不产出截断文案", async () => {
    const s = snap({ experimentId: "fail/few", results: [res("q1", "failed")] });
    const text = await renderTreeText(<FailureList />, scopeOf([s]));
    expect(text).not.toContain("more not shown");
  });
});

// ───────────────────────── Table 与排版原语 ─────────────────────────

describe("Table 与文本排版原语", () => {
  const ctx = () => createTextContext({ width: 100 });

  it("null 单元格与 cells 缺键都渲染成 —,不补 0", () => {
    const text = renderNodeToText(
      <Table
        columns={[
          { key: "a", header: "A" },
          { key: "b", header: "B", align: "right" },
        ]}
        rows={[
          { key: "r1", cells: { a: "x", b: null } },
          { key: "r2", cells: { a: "y" } },
        ]}
      />,
      ctx(),
    );
    expect(text.match(/—/g)!.length).toBe(2);
    expect(text).not.toMatch(/\b0\b/);
  });

  it("cells 出现未声明的 key 以完整用户反馈报错;列 key 重复报错", () => {
    expect(() =>
      renderNodeToText(
        <Table columns={[{ key: "a", header: "A" }]} rows={[{ key: "r", cells: { ghost: "x" } }]} />,
        ctx(),
      ),
    ).toThrow(/no column declares/);
    expect(() =>
      renderNodeToText(
        <Table
          columns={
            [
              { key: "a", header: "A" },
              { key: "a", header: "A2" },
            ] as never
          }
          rows={[]}
        />,
        ctx(),
      ),
    ).toThrow(/declared twice/);
  });

  it("带 locator 的行多出 attempt 列;全部无 locator 时不出该列", () => {
    const withLocator = renderNodeToText(
      <Table
        columns={[{ key: "a", header: "A" }]}
        rows={[
          { key: "r1", cells: { a: "x" }, locator: "@1abc0def" as never },
          { key: "r2", cells: { a: "y" } },
        ]}
      />,
      ctx(),
    );
    expect(withLocator).toContain("@1abc0def");
    expect(withLocator).toContain("attempt");
    const without = renderNodeToText(
      <Table columns={[{ key: "a", header: "A" }]} rows={[{ key: "r1", cells: { a: "x" } }]} />,
      ctx(),
    );
    expect(without).not.toContain("attempt");
  });

  it("Row text 面:宽度装得下按显示宽度并排,装不下整块纵向堆叠、内容完整", () => {
    const tree = (
      <Row>
        <Text>left block</Text>
        <Text>right block</Text>
      </Row>
    );
    const wide = renderNodeToText(tree, createTextContext({ width: 80 }));
    expect(wide.split("\n")[0]).toContain("left block");
    expect(wide.split("\n")[0]).toContain("right block");
    const narrow = renderNodeToText(tree, createTextContext({ width: 20 }));
    expect(narrow).toContain("left block");
    expect(narrow).toContain("right block");
    expect(narrow.split("\n")[0]).not.toContain("right block"); // 纵向堆叠
  });

  it("Style 在 text 面零输出,web 面吐 <style>(页级全局)", async () => {
    const scope = scopeOf([]);
    const definition = defineReport(
      <Col>
        <Style>{`.nre .x { color: red; }`}</Style>
        <Text>visible</Text>
      </Col>,
    );
    const hostCtx = { scope, results: resultsOf([]) };
    const text = await renderReportToText(definition, hostCtx);
    expect(text).toBe("visible");
    const html = await renderReportToStaticHtml(definition, hostCtx);
    expect(html).toContain("<style>");
  });
});

// ───────────────────────── Tabs ─────────────────────────

describe("Tabs", () => {
  it("两面都输出全部 tab 完整内容:web 每 tab 一个 <details> 且仅首个 open;text 按声明序分节不省略", async () => {
    const scope = scopeOf([]);
    const definition = defineReport(
      <Tabs>
        <Tab title="First">
          <Text>alpha body</Text>
        </Tab>
        <Tab title="Second">
          <Text>beta body</Text>
        </Tab>
      </Tabs>,
    );
    const hostCtx = { scope, results: resultsOf([]) };
    const html = await renderReportToStaticHtml(definition, hostCtx);
    expect(html.match(/<details/g)).toHaveLength(2);
    expect(html.match(/<details[^>]* open/g)).toHaveLength(1);
    expect(html).toContain("alpha body");
    expect(html).toContain("beta body");
    const text = await renderReportToText(definition, hostCtx);
    expect(text.indexOf("First")).toBeLessThan(text.indexOf("Second"));
    expect(text).toContain("alpha body");
    expect(text).toContain("beta body"); // 不丢第二个 tab
  });

  it("空 Tabs、普通组件混作直接子节点、游离 Tab 都在树校验期给出完整用户反馈", () => {
    expect(() => validateReportTree(<Tabs>{null}</Tabs>)).toThrow(/at least one <Tab>/);
    expect(() =>
      validateReportTree(
        <Tabs>
          <Text>stray</Text>
        </Tabs>,
      ),
    ).toThrow(/only accepts <Tab>/);
    expect(() =>
      validateReportTree(
        <Col>
          <Tab title="loose">
            <Text>x</Text>
          </Tab>
        </Col>,
      ),
    ).toThrow(/direct child of <Tabs>/);
  });
});

// ───────────────────────── defineReport 装载规范化 ─────────────────────────

describe("defineReport 装载规范化", () => {
  it("三种写法装载出等价的规范化结果:树 ≡ {content} ≡ pages [{id: report}]", () => {
    const tree = <ScopeSummary />;
    const fromTree = defineReport(tree);
    const fromContent = defineReport({ content: tree });
    const fromPages = defineReport({
      pages: [{ id: "report", title: { en: "Report", "zh-CN": "报告" }, content: tree }],
    });
    for (const definition of [fromTree, fromContent, fromPages]) {
      expect(definition.kind).toBe("report");
      expect(definition.pages).toHaveLength(1);
      expect(definition.pages[0]!.id).toBe("report");
      expect(definition.pages[0]!.content).toBe(tree);
    }
    expect(fromTree.pages[0]!.title).toEqual(fromContent.pages[0]!.title);
  });

  it("content 与 pages 同时声明或都省略,装载报错且文案给出 extends: standard 下一步", () => {
    expect(() => defineReport({ content: <ScopeSummary />, pages: [] } as never)).toThrow(
      /"content" and "pages" — declare exactly one/,
    );
    expect(() => defineReport({ title: "X" } as never)).toThrow(/niceeval\/report\/built-in/);
  });

  it("defineReport 产物不是 ReportNode:页里放产物装载报错;树校验同样拒绝", () => {
    const inner = defineReport(<ScopeSummary />);
    expect(() => defineReport({ pages: [{ id: "a", title: "A", content: inner as never }] })).toThrow(
      /shell cannot nest/,
    );
    expect(() => defineReport(inner as never)).toThrow(/shell cannot nest/);
    expect(() => validateReportTree([inner] as never)).toThrow(/not a report node/);
  });

  it("重复或非法 page id 装载报错并点名冲突;LocalizedText 全空对象报错", () => {
    expect(() =>
      defineReport({
        pages: [
          { id: "exam", title: "A", content: null },
          { id: "exam", title: "B", content: null },
        ],
      }),
    ).toThrow(/"exam" is declared twice/);
    expect(() => defineReport({ pages: [{ id: "Bad/Id", title: "A", content: null }] })).toThrow(/invalid/);
    expect(() => defineReport({ title: {}, content: null })).toThrow(/no non-empty value/);
  });

  it("page 省略 input 规范化为 scope + navigation:true;显式 attempt 必须 navigation:false", () => {
    const definition = defineReport({
      pages: [
        { id: "report", title: "Report", content: null },
        { id: "attempt", title: "Attempt", input: "attempt", navigation: false, content: null },
      ],
    });
    expect(definition.pages[0]).toMatchObject({ input: "scope", navigation: true });
    expect(definition.pages[1]).toMatchObject({ input: "attempt", navigation: false });

    expect(() =>
      defineReport({
        pages: [
          // @ts-expect-error input:"attempt" 必须显式 navigation:false;这里模拟无类型 JS 输入
          { id: "a", title: "A", input: "attempt", content: null },
        ],
      }),
    ).toThrow(/navigation: false/);
    expect(() =>
      defineReport({
        pages: [
          // @ts-expect-error navigation:true 与 input:"attempt" 互斥;这里模拟无类型 JS 输入
          { id: "a", title: "A", input: "attempt", navigation: true, content: null },
        ],
      }),
    ).toThrow(/navigation: false/);
  });

  it("navigation: false 的 scope-input page 不进导航但仍是普通 scope page", () => {
    const definition = defineReport({
      pages: [
        { id: "report", title: "Report", content: null },
        { id: "hidden", title: "Hidden", navigation: false, content: null },
      ],
    });
    expect(definition.pages[1]).toMatchObject({ input: "scope", navigation: false });
  });

  it("一份 definition 最多一张 attempt-input page,第二张同类 page 装载报错", () => {
    expect(() =>
      defineReport({
        pages: [
          { id: "a1", title: "A1", input: "attempt", navigation: false, content: null },
          { id: "a2", title: "A2", input: "attempt", navigation: false, content: null },
        ],
      }),
    ).toThrow(/at most one input: "attempt" page/);
  });

  it("{src} 资产拒绝 .. 路径段、绝对路径与 ~;inline/src 互斥", () => {
    expect(() => defineReport({ content: null, scripts: [{ src: "../x.js" }] })).toThrow(/not allowed/);
    expect(() => defineReport({ content: null, scripts: [{ src: "/abs.js" }] })).toThrow(/not allowed/);
    expect(() => defineReport({ content: null, styles: [{ src: "~/x.css" }] })).toThrow(/not allowed/);
    expect(() => defineReport({ content: null, scripts: [{ src: "./a.js", inline: "x" } as never] })).toThrow(
      /exactly one/,
    );
    expect(() => defineReport({ content: null, scripts: [{ src: "./assets/a.js" }] })).not.toThrow();
  });

  it("--page 语义:pickReportPage 缺省第一页,未命中抛 ReportPageNotFoundError 列出可用页", () => {
    const definition = defineReport({
      pages: [
        { id: "overview", title: "Overview", content: null },
        { id: "exam", title: "Exam", content: null },
      ],
    });
    expect(pickReportPage(definition).id).toBe("overview");
    expect(pickReportPage(definition, "exam").id).toBe("exam");
    try {
      pickReportPage(definition, "typo");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ReportPageNotFoundError);
      expect((e as ReportPageNotFoundError).available).toEqual(["overview", "exam"]);
    }
    // 树形态文件的唯一页 id 是缩写展开出的 report
    const single = defineReport(<ScopeSummary />);
    expect(pickReportPage(single, "report").id).toBe("report");
  });

  it("pickReportPage 缺省跳过 navigation:false 的页,只挑第一张可导航页;可用列表也只含可导航页", () => {
    const definition = defineReport({
      pages: [
        { id: "hidden", title: "Hidden", navigation: false, content: null },
        { id: "overview", title: "Overview", content: null },
        { id: "attempt", title: "Attempt", input: "attempt", navigation: false, content: null },
      ],
    });
    expect(pickReportPage(definition).id).toBe("overview");
    try {
      pickReportPage(definition, "typo");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ReportPageNotFoundError);
      expect((e as ReportPageNotFoundError).available).toEqual(["overview"]);
    }
  });

  it("显式选择 attempt-input page 但没有 locator:ReportPageNeedsLocatorError", () => {
    const definition = defineReport({
      pages: [
        { id: "report", title: "Report", content: null },
        { id: "attempt", title: "Attempt", input: "attempt", navigation: false, content: null },
      ],
    });
    expect(() => pickReportPage(definition, "attempt")).toThrow(ReportPageNeedsLocatorError);
  });

  it("标题回退链:def.title → 唯一且相同的快照 name → 内置文案「Eval 运行结果 / Eval Results」;en 相同 zh 不同也落内置文案", () => {
    const named = snap({ experimentId: "t/a", name: "Memory Evals", results: [res("q", "passed")] });
    const definition = defineReport(<ScopeSummary />);
    expect(resolveReportTitle(defineReport({ title: "Custom", content: null }), scopeOf([named]))).toBe("Custom");
    expect(resolveReportTitle(definition, scopeOf([named]))).toBe("Memory Evals");
    expect(resolveReportTitle(definition, scopeOf([snap({ experimentId: "t/b", results: [] })]))).toEqual(
      FALLBACK_REPORT_TITLE,
    );
    const zhA = snap({ experimentId: "t/c", name: { en: "Same", "zh-CN": "一" }, results: [] });
    const zhB = snap({ experimentId: "t/d", name: { en: "Same", "zh-CN": "二" }, results: [] });
    expect(resolveReportTitle(definition, scopeOf([zhA, zhB]))).toEqual(FALLBACK_REPORT_TITLE);
    expect(FALLBACK_REPORT_TITLE).toEqual({ en: "Eval Results", "zh-CN": "Eval 运行结果" });
  });

  it("ReportLink.icon 是 { svg: string }:defineReport 接受合法形状;无类型 JS 传其它形状定义时报完整用户反馈", () => {
    const svg = '<svg viewBox="0 0 16 16"><path d="M0 0h16v16z"/></svg>';
    const withIcon = defineReport({
      content: null,
      links: [{ label: "GitHub", href: "https://example.com", icon: { svg } }],
    });
    expect(withIcon.links[0]!.icon).toEqual({ svg });

    const reactNode = { $$typeof: Symbol.for("react.transitional.element"), type: "svg", props: {} };
    for (const icon of [reactNode, "<svg/>", { svg: 42 }, { svg: "" }]) {
      expect(() =>
        defineReport({
          content: null,
          links: [{ label: "GitHub", href: "https://example.com", icon: icon as never }],
        }),
      ).toThrow(/"icon" must be \{ svg: string \}/);
    }
  });
});

// ───────────────────────── 内建报告 ─────────────────────────

describe("内建报告", () => {
  it("三页普通 defineReport:页 id、页名与逐页组件构成和 built-in.md 全文一致", () => {
    expect(builtInReport.kind).toBe("report");
    expect(builtInReport.pages.map((p) => p.id)).toEqual(["report", "attempts", "traces"]);
    expect(builtInReport.pages.map((p) => p.title)).toEqual([
      { en: "Report", "zh-CN": "报告" },
      "Attempts",
      { en: "Traces", "zh-CN": "追踪" },
    ]);
    // 逐页组件构成:每页一个 Col,children 按 built-in.md 全文的声明序,全部是公开组件。
    const childTypes = (content: unknown) => {
      const col = content as { type: unknown; props: { children: Array<{ type: unknown; props: Record<string, unknown> }> } };
      expect(col.type).toBe(Col);
      return col.props.children;
    };
    const [reportPage, attemptsPage, tracesPage] = builtInReport.pages;
    expect(childTypes(reportPage!.content).map((c) => c.type)).toEqual([
      Hero,
      ScopeWarnings,
      CopyFixPrompt,
      ExperimentComparison,
    ]);
    const attemptsChildren = childTypes(attemptsPage!.content);
    expect(attemptsChildren.map((c) => c.type)).toEqual([Hero, ScopeWarnings, AttemptList]);
    expect(attemptsChildren[2]!.props.filter).toBe(true);
    expect(childTypes(tracesPage!.content).map((c) => c.type)).toEqual([Hero, ScopeWarnings, TraceWaterfall]);
  });

  it("与 --report 同内容文件完全等价:同一棵页树经同一条管线渲染出逐字节相同的两面", async () => {
    const s1 = snap({ experimentId: "compare/a", agent: "bub", results: [res("q", "passed")] });
    const s2 = snap({ experimentId: "compare/b", agent: "codex", results: [res("q", "failed")] });
    const scope = scopeOf([s1, s2]);
    const ctx = { scope, results: resultsOf([s1, s2]) };
    // 用户按 built-in.md 全文自己写同内容的 defineReport(不 import 内建入口)。
    const user = defineReport({
      pages: [
        {
          id: "report",
          title: { en: "Report", "zh-CN": "报告" },
          content: (
            <Col>
              <Hero />
              <ScopeWarnings />
              <CopyFixPrompt />
              <ExperimentComparison />
            </Col>
          ),
        },
        { id: "attempts", title: "Attempts", content: <Col><Hero /><ScopeWarnings /><AttemptList filter /></Col> },
        {
          id: "traces",
          title: { en: "Traces", "zh-CN": "追踪" },
          content: <Col><Hero /><ScopeWarnings /><TraceWaterfall /></Col>,
        },
      ],
    });
    for (const pageId of ["report", "attempts", "traces"]) {
      expect(await renderReportToText(builtInReport, ctx, { width: 120, pageId })).toBe(
        await renderReportToText(user, ctx, { width: 120, pageId }),
      );
      expect(await renderReportToStaticHtml(builtInReport, ctx, { pageId })).toBe(
        await renderReportToStaticHtml(user, ctx, { pageId }),
      );
    }
  });

  it("首页 web/text 两面都展示完整 Scope,不同深度目录的 experiment 同屏且显示完整 id;无组选择器或组索引", async () => {
    const g1 = snap({ experimentId: "compare/a", results: [res("q", "passed")] });
    const g2 = snap({ experimentId: "dev/b", results: [res("q", "failed")] });
    const ctx = { scope: scopeOf([g1, g2]), results: resultsOf([g1, g2]) };

    const text = await renderReportToText(builtInReport, ctx, { width: 120 });
    // Hero text 面:标题行(回退链终点)+ 最后运行 meta 行在页首
    expect(text.split("\n")[0]).toBe("Eval Results");
    expect(text).toContain("Last run");
    // 完整 Scope 直接展示:两个不同路径的 experiment 都可见,不是组索引 + 单组查看命令
    expect(text).toContain("compare/a");
    expect(text).toContain("dev/b");
    expect(text).not.toContain("niceeval show --exp compare");
    expect(text).not.toContain("niceeval show --exp dev");
    expect(text).not.toContain("niceeval exp compare");
    expect(text).not.toContain("niceeval exp dev");

    const html = await renderReportToStaticHtml(builtInReport, ctx);
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain("data-nre-experiment-group");
    expect(html).toContain("compare/a");
    expect(html).toContain("dev/b");
  });

  it("0/1/多 experiment 均可渲染;0 个时两面显示空态", async () => {
    const empty = { scope: scopeOf([]), results: resultsOf([]) };
    const emptyText = await renderReportToText(builtInReport, empty, { width: 120 });
    expect(emptyText).toContain("No experiments");
    const emptyHtml = await renderReportToStaticHtml(builtInReport, empty);
    expect(emptyHtml).toContain("No experiments");

    const priced = snap({
      experimentId: "compare/priced",
      results: [res("q", "passed", { usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.2 } })],
    });
    const single = await renderReportToText(
      builtInReport,
      { scope: scopeOf([priced]), results: resultsOf([priced]) },
      { width: 140 },
    );
    expect(single).toContain("Eval / Attempt"); // 单 experiment 直接展示散点与实验明细
    // 成本轴(better: lower)反向渲染,「更好」恒指向右上;两轴都声明 better → 提示在场
    expect(single).toContain("better → upper right");
  });
});

// ───────────────────────── extends 与内建视图集合 ─────────────────────────

describe("extends 与内建视图集合", () => {
  it("内建入口是视图集合:默认导出与具名导出 standard 同引用", () => {
    expect(builtInReport).toBe(standard);
  });

  it("extends 叠外壳:页列表与 base 逐项同引用,声明整字段覆盖、未声明沿用 base", () => {
    const branded = defineReport({
      extends: standard,
      title: "Memory Evals",
      links: [{ label: "GitHub", href: "https://github.com/you/repo" }],
    });
    branded.pages.forEach((page, i) => expect(page).toBe(standard.pages[i]));
    expect(branded.title).toBe("Memory Evals");
    expect(branded.links).toEqual([{ label: "GitHub", href: "https://github.com/you/repo" }]);
    expect(branded.head).toEqual([...standard.head]); // 未声明沿用 base

    // 二级 extends 链:上一次折叠的产物就是下一次的 base
    const chained = defineReport({ extends: branded, links: [] });
    chained.pages.forEach((page, i) => expect(page).toBe(standard.pages[i]));
    expect(chained.title).toBe("Memory Evals"); // 未声明沿用最近声明
    expect(chained.links).toEqual([]); // 声明即整字段覆盖,不拼接

    // ctx.report.title 取 extends 上声明的 title
    const s = snap({ experimentId: "compare/a", results: [res("q", "passed")] });
    expect(buildReportMeta(branded, scopeOf([s])).title).toBe("Memory Evals");
  });

  it("无外壳字段的 extends 与内建逐页两面渲染逐字节相同", async () => {
    const s1 = snap({ experimentId: "compare/a", agent: "bub", results: [res("q", "passed")] });
    const s2 = snap({ experimentId: "compare/b", agent: "codex", results: [res("q", "failed")] });
    const ctx = { scope: scopeOf([s1, s2]), results: resultsOf([s1, s2]) };
    const alias = defineReport({ extends: standard });
    for (const pageId of ["report", "attempts", "traces"]) {
      expect(await renderReportToText(alias, ctx, { width: 120, pageId })).toBe(
        await renderReportToText(builtInReport, ctx, { width: 120, pageId }),
      );
      expect(await renderReportToStaticHtml(alias, ctx, { pageId })).toBe(
        await renderReportToStaticHtml(builtInReport, ctx, { pageId }),
      );
    }
  });

  it("extends 只收 defineReport 产物;与 content/pages 多选或全省略按完整用户反馈报错", () => {
    // @ts-expect-error 非 defineReport 产物,类型层已拒绝;这里模拟无类型 JS 输入
    expect(() => defineReport({ extends: {} })).toThrow(/must be a defineReport\(\.\.\.\) product/);
    // @ts-expect-error extends 与 pages 互斥
    expect(() => defineReport({ extends: standard, pages: standard.pages })).toThrow(/declare exactly one/);
    // @ts-expect-error content / pages / extends 至少声明一个
    expect(() => defineReport({ title: "x" })).toThrow(/niceeval\/report\/built-in/);
  });
});
