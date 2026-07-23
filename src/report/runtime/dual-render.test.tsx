// cases: docs/engineering/testing/unit/reports.md
// 管线测试(resolve/validate/装载规范化):spec/data 双形态严格等价、记忆化、组合组件递归展开、
// 同层并行保序、非法节点拒绝、defineReport 三种写法与外壳嵌套的装载规范化、标题回退链、
// 内建报告的结构与具名导出同引用、组合组件(FailureList / ExperimentComparison)与手写组合的
// 解析结果严格等价。
//
// 观察面全部是 resolve 阶段的解析结果(元素 type / props,尤其是叶子组件的 `data` 字段)与装载
// 产物的结构、或者抛出的错误对象——不渲染到文本或 HTML 去比较两条路径。渲染出的终端排版、DOM
// 结构、text/web 双面比对属于 docs/engineering/testing/e2e/report.md,不在本层验收。
//
// 例外:Table 的列 / 行 key 校验目前只长在 web()/text() 两个渲染面函数体内(没有独立导出的纯
// 校验函数),要触发它只能经 renderNodeToText;断言对象仍是抛出的 Error,不是渲染内容本身。

import { describe, expect, it } from "vitest";

import type { AssertionResult, EvalResult, Verdict } from "../../types.ts";
import type { AttemptHandle, Results, Scope, Snapshot } from "../../results/index.ts";
import { resultsOf, scopeOf } from "../components/scope.harness.ts";
import {
  createTextContext,
  defineComponent,
  renderNodeToText,
  resolveReportTree,
  validateReportTree,
  ResolveMemo,
  type ReportNode,
} from "../definition/tree.ts";
import { buildReportMeta, defineReport, FALLBACK_REPORT_TITLE, resolveReportTitle } from "../definition/report.ts";
import { pickReportPage, ReportPageNeedsLocatorError, ReportPageNotFoundError } from "./text.ts";
import { AttemptList, ExperimentList, FailureList } from "../components/entity-lists/index.tsx";
import { CopyFixPrompt, Hero, ScopeWarnings, SnapshotDiagnostics, TraceWaterfall } from "../components/site-components/index.tsx";
import { ExperimentComparison, ScopeSummary } from "../components/summaries/index.tsx";
import { GroupMatrix, MetricBars, MetricMatrix, MetricScatter, MetricTable } from "../components/metric-views/index.tsx";
import { AttemptDetail } from "../components/attempt-detail/index.tsx";
import { Col, Section, Tab, Table, Tabs, Text } from "../definition/primitives.tsx";
import { attemptListData, experimentListData } from "../components/entity-lists/compute.ts";
import { metricScatterData } from "../components/metric-views/compute.ts";
import { scopeSummaryData } from "../components/summaries/compute.ts";
import { costUSD, defineMetric, endToEndPassRate, totalScore } from "../model/metrics.ts";
import { label } from "../model/flag.ts";
import builtInReport, { standard, standardAttemptPage } from "../built-in/index.tsx";

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
    carried: Boolean(r.artifactBase),
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

/**
 * 管线便捷入口:装载 + 挑页 + resolve + validate,不渲染——断言面是解析后的树结构
 * (元素 type / props)或抛出的错误对象。裸字符串 / 非法节点这类只在 validate 阶段
 * 才拒绝的输入,同样会在这里抛出(validateReportTree 紧跟 resolve 之后调用)。
 */
async function resolveTree(node: ReportNode, scope: Scope): Promise<ReportNode> {
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
  return resolved;
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

  it("spec 形态与「先手工调 *Data 再传 data」严格等价:两棵树解析出同一份 data", async () => {
    const scope = scatterScope();
    const options = { points: "experiment", series: "agent", x: costUSD, y: endToEndPassRate } as const;
    const specResolved = await resolveTree(<MetricScatter points="experiment" series="agent" x={costUSD} y={endToEndPassRate} />, scope);
    const data = await metricScatterData(scope, options);
    expect((specResolved as unknown as { props: { data: unknown } }).props.data).toEqual(data);
  });

  it("同一组件同时给 data 与 spec 字段报完整用户反馈,不静默取一边", async () => {
    const scope = scatterScope();
    const data = await metricScatterData(scope, { points: "experiment", x: costUSD, y: endToEndPassRate });
    await expect(
      resolveTree(
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

    const allResolved = await resolveTree(<ScopeSummary />, scope);
    expect((allResolved as unknown as { props: { data: unknown } }).props.data).toEqual(await scopeSummaryData(scope));

    const narrowed = scope.filter((s) => s.experimentId === "in/a");
    const narrowedResolved = await resolveTree(<ScopeSummary input={narrowed} />, scope);
    expect((narrowedResolved as unknown as { props: { data: unknown } }).props.data).toEqual(await scopeSummaryData(narrowed));

    // input 也可以是手挑的 Snapshot[](按快照出行)
    const tableResolved = await resolveTree(<MetricTable input={[a]} rows="snapshot" columns={[endToEndPassRate]} />, scope);
    const rows = (tableResolved as unknown as { props: { data: { rows: Array<{ key: string }> } } }).props.data.rows;
    expect(rows.some((r) => r.key.startsWith("in/a"))).toBe(true);
    expect(rows.some((r) => r.key.startsWith("in/b"))).toBe(false);
  });

  it("data 结构校验:字段改名前的旧 JSON 报错且文案含版本漂移提示;round-trip 的同版本 JSON 解析结果不变", async () => {
    const scope = scatterScope();
    const table = { dimension: "agent", columns: [], rows: [] }; // 旧形状:dimension 而非 rowDimension
    await expect(resolveTree(<MetricTable data={table as never} />, scope)).rejects.toThrow(
      /does not match the current TableData shape[\s\S]*different niceeval version/,
    );

    const fresh = await metricScatterData(scope, { points: "experiment", x: costUSD, y: endToEndPassRate });
    const roundTrip = JSON.parse(JSON.stringify(fresh));
    const resolved = await resolveTree(<MetricScatter data={roundTrip} />, scope);
    expect((resolved as unknown as { props: { data: unknown } }).props.data).toEqual(roundTrip);
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
    await resolveTree(
      <Col>
        <MetricMatrix rows="eval" columns="agent" cell={counted} />
        <MetricBars rows="eval" columns="agent" cell={counted} />
      </Col>,
      scope,
    );
    expect(calls).toBe(1); // 一个 attempt,矩阵只算一遍

    calls = 0;
    await resolveTree(
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
    await resolveTree(
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
  it("resolve 阶段以 (props, ctx) 调用并递归展开;与手写等价树解析出同一棵树;async 可用", async () => {
    const scope = scopeOf([snap({ experimentId: "compose/a", results: [res("q", "passed")] })]);
    const Composed = defineComponent(async (_props: Record<never, never>, ctx) => (
      <Section title="wrapped">
        <ScopeSummary input={ctx.scope} />
      </Section>
    ));
    const composed = await resolveTree(<Composed />, scope);
    const manual = await resolveTree(
      <Section title="wrapped">
        <ScopeSummary />
      </Section>,
      scope,
    );
    expect(composed).toEqual(manual);
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
    const page = pickReportPage(definition, "meta");
    const resolved = await resolveReportTree(page.content, {
      scope,
      results: resultsOf([named]),
      report: buildReportMeta(definition, scope),
      page: { id: page.id, input: "scope" },
      memo: new ResolveMemo(),
    });
    const textNode = (resolved as unknown as { props: { children: Array<{ props: { children: string } }> } }).props.children[0]!;
    // 声明没给 title → 唯一快照 name 回退
    expect(textNode.props.children).toBe("title=Memory Evals page=meta");
  });

  it("同层 sibling 并行取数且解析结果保持声明顺序:慢 resolve 在前不换位", async () => {
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
    const resolved = await resolveTree(
      <Col>
        <Slow label="first" />
        <Fast label="second" />
      </Col>,
      scope,
    );
    expect(order[0]).toBe("fast-resolved"); // 真并行:快的先完成
    const children = (resolved as unknown as { props: { children: Array<{ props: { label: string } }> } }).props.children;
    expect(children.map((c) => c.props.label)).toEqual(["first", "second"]); // 解析结果仍按声明序
  });
});

describe("ReportNode 形状与非法节点", () => {
  const scope = () => scopeOf([snap({ experimentId: "node/a", results: [res("q", "passed")] })]);

  it("裸字符串在树校验时按完整用户反馈拒绝并指引包 <Text>", async () => {
    await expect(resolveTree(<Col>{"free text" as unknown as ReportNode}</Col>, scope())).rejects.toThrow(
      /bare string[\s\S]*<Text>/,
    );
  });

  it("React 组件 / 未包装函数与 HTML intrinsic 在展开遇到时拒绝", async () => {
    const Plain = ({ label }: { label: string }) => <p>{label}</p>;
    await expect(resolveTree(<Plain label="x" />, scope())).rejects.toThrow(
      /not a report component[\s\S]*defineComponent/,
    );
    await expect(resolveTree(<div>x</div>, scope())).rejects.toThrow(/raw HTML <div>/);
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

// ───────────────────────── 渐进增强不改数据 ─────────────────────────

describe("渐进增强不改数据的不变量", () => {
  it("filter 只改变浏览状态:有无 filter prop 解析出的 data 相同", async () => {
    const scope = scopeOf([snap({ experimentId: "f/a", results: [res("q", "passed")] })]);
    const plain = await resolveTree(<MetricTable rows="experiment" columns={[endToEndPassRate]} />, scope);
    const filtered = await resolveTree(<MetricTable rows="experiment" columns={[endToEndPassRate]} filter />, scope);
    expect((filtered as unknown as { props: { data: unknown } }).props.data).toEqual(
      (plain as unknown as { props: { data: unknown } }).props.data,
    );
  });
});

// ───────────────────────── FailureList ─────────────────────────

describe("FailureList", () => {
  it("与手写组合(attemptListData → 过滤 → 排序 → 截断)严格等价:failed/errored、开始时间降序、limit 截断且 total 报截断前总数", async () => {
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
    const resolved = await resolveTree(<FailureList limit={2} />, scope);

    // 手写组合:attemptListData → 过滤 → 排序(最近的失败在前)→ 截断到 limit。
    const all = await attemptListData(scope);
    const startedAt = new Map(s.attempts.map((a) => [a.evalId, a.result.startedAt ?? ""]));
    const failures = all
      .filter((x) => x.verdict === "failed" || x.verdict === "errored")
      .sort((a, b) => (startedAt.get(b.evalId) ?? "").localeCompare(startedAt.get(a.evalId) ?? ""));

    const props = (resolved as unknown as { props: { data: unknown; total?: number } }).props;
    expect(props.data).toEqual(failures.slice(0, 2)); // 截断到 2,且顺序 = q2(最近)在前、q3 在后
    expect(props.total).toBe(failures.length); // total 报截断前总数(3),不是 data.length
  });

  it("失败数少于 limit 时 total 等于 data 长度,不产生截断信号", async () => {
    const s = snap({ experimentId: "fail/few", results: [res("q1", "failed")] });
    const resolved = await resolveTree(<FailureList />, scopeOf([s]));
    const props = (resolved as unknown as { props: { data: unknown[]; total?: number } }).props;
    expect(props.total).toBe(props.data.length);
  });
});

// ───────────────────────── Table 装载校验 ─────────────────────────

describe("Table 装载校验", () => {
  it("cells 出现未声明的 key 以完整用户反馈报错;列 key 重复报错", () => {
    const ctx = createTextContext({ width: 100 });
    expect(() =>
      renderNodeToText(
        <Table columns={[{ key: "a", header: "A" }]} rows={[{ key: "r", cells: { ghost: "x" } }]} />,
        ctx,
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
        ctx,
      ),
    ).toThrow(/declared twice/);
  });
});

// ───────────────────────── Tabs ─────────────────────────

describe("Tabs", () => {
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
  it("四页普通 defineReport:页 id、页名与逐页组件构成和 built-in.md 全文一致,第四页是不进导航的 attempt-input page", () => {
    expect(builtInReport.kind).toBe("report");
    expect(builtInReport.pages.map((p) => p.id)).toEqual(["report", "attempts", "traces", "attempt"]);
    expect(builtInReport.pages.map((p) => p.title)).toEqual([
      { en: "Report", "zh-CN": "报告" },
      "Attempts",
      { en: "Traces", "zh-CN": "追踪" },
      "Attempt",
    ]);
    // 逐页组件构成:每页一个 Col,children 按 built-in.md 全文的声明序,全部是公开组件。
    const childTypes = (content: unknown) => {
      const col = content as { type: unknown; props: { children: Array<{ type: unknown; props: Record<string, unknown> }> } };
      expect(col.type).toBe(Col);
      return col.props.children;
    };
    const [reportPage, attemptsPage, tracesPage, attemptPage] = builtInReport.pages;
    expect(childTypes(reportPage!.content).map((c) => c.type)).toEqual([
      Hero,
      ScopeWarnings,
      SnapshotDiagnostics,
      CopyFixPrompt,
      ExperimentComparison,
      GroupMatrix,
    ]);
    const attemptsChildren = childTypes(attemptsPage!.content);
    expect(attemptsChildren.map((c) => c.type)).toEqual([Hero, ScopeWarnings, SnapshotDiagnostics, AttemptList]);
    expect(attemptsChildren[3]!.props.filter).toBe(true);
    expect(childTypes(tracesPage!.content).map((c) => c.type)).toEqual([Hero, ScopeWarnings, SnapshotDiagnostics, TraceWaterfall]);
    // 第四页是参数化详情页:content 就是裸 AttemptDetail(不套 Col),input/navigation 与文档一致。
    // defineReport 规范化会重建页对象(id/title/content 逐字段拷贝),所以整页对象不可能与
    // 具名导出 standardAttemptPage 保持引用相等;但 content 字段是原样透传,同引用证明
    // standard.tsx 确实把 standardAttemptPage 整个复用进了 pages 数组,不是另抄一份同形的
    // <AttemptDetail /> JSX(两次书写同样的 JSX 字面量在运行时是两个不同的 element 对象)。
    expect(attemptPage!.content).toBe(standardAttemptPage.content);
    expect(attemptPage).toEqual(standardAttemptPage);
    expect(attemptPage!.input).toBe("attempt");
    expect(attemptPage!.navigation).toBe(false);
    expect((attemptPage!.content as { type: unknown }).type).toBe(AttemptDetail);
  });
});

// ───────────────────────── ExperimentComparison(组合组件)─────────────────────────

describe("ExperimentComparison(组合组件)", () => {
  /** 展开树里 [ScopeSummary, MetricScatter, ExperimentList] 三个已解析元素。 */
  async function resolveComparisonChildren(
    node: ReportNode,
    snapshots: Snapshot[],
  ): Promise<Array<{ props: { data: unknown } }>> {
    const scope = scopeOf(snapshots);
    const definition = defineReport(node);
    const page = pickReportPage(definition);
    const resolved = (await resolveReportTree(page.content, {
      scope,
      results: resultsOf(snapshots),
      report: buildReportMeta(definition, scope),
      page: { id: page.id, input: "scope" },
      memo: new ResolveMemo(),
    })) as unknown as { props: { children: Array<{ props: { data: unknown } }> } };
    return resolved.props.children;
  }

  /** 计分制 fixture 用的最小断言记录:一条 gate 断言,`points` 挣分。 */
  function scoreAssertion(points: number): AssertionResult {
    return { name: "x", severity: "gate", outcome: "passed", score: 1, points } as AssertionResult;
  }

  /**
   * 递归收集展开树里 `.type === target` 的全部已解析元素;不假设固定的嵌套形状——
   * mixed 分支具体套几层 <Col> 是实现细节,这里只认组件类型,不认树里的位置。
   */
  function collectElementsByType(
    node: unknown,
    target: unknown,
    out: Array<{ props: Record<string, unknown> }> = [],
  ): Array<{ props: Record<string, unknown> }> {
    if (node === null || node === undefined || typeof node !== "object") return out;
    if (Array.isArray(node)) {
      for (const child of node) collectElementsByType(child, target, out);
      return out;
    }
    const el = node as { type?: unknown; props?: { children?: unknown } };
    if (el.type === target) out.push(el as { props: Record<string, unknown> });
    if (el.props && "children" in el.props) collectElementsByType(el.props.children, target, out);
    return out;
  }

  it("不同深度目录的 experiments 一律进同一份 data;展开树里 ScopeSummary / MetricScatter / ExperimentList 的解析结果与直接调用三个函数深等", async () => {
    const g1a = snap({ experimentId: "compare/a", agent: "bub", results: [res("q", "passed")] });
    const g1b = snap({ experimentId: "compare/b", agent: "codex", results: [res("q", "failed")] });
    const g2 = snap({ experimentId: "bench/long/x", results: [res("q", "passed")] });
    const solo = snap({ experimentId: "standalone", results: [res("q", "failed")] });
    const all = [g1a, g1b, g2, solo];
    const [summaryEl, scatterEl, listEl] = await resolveComparisonChildren(<ExperimentComparison />, all);
    expect(listEl.props.data).toEqual(await experimentListData(all));
    expect(summaryEl.props.data).toEqual(await scopeSummaryData(all));
    expect(scatterEl.props.data).toEqual(
      await metricScatterData(all, { points: "experiment", series: "agent", x: costUSD, y: endToEndPassRate }),
    );
  });

  it("series 缺省解析:Scope 内任一 experiment 声明 labels.line 时全图 line,完全无 line 时 agent;显式 series 覆盖缺省", async () => {
    const withCost = { usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.1 } };
    const withLine = snap({ experimentId: "series/with-line", results: [res("q", "passed", withCost)] });
    withLine.experiment = { runs: 1, earlyExit: false, selectedEvalIds: ["q"], labels: { line: "codex" } };
    const withoutLine = snap({ experimentId: "series/plain", results: [res("q", "passed", withCost)] });

    const [, scatterWithLine] = await resolveComparisonChildren(<ExperimentComparison />, [withLine, withoutLine]);
    expect((scatterWithLine.props.data as { seriesDimension?: string }).seriesDimension).toBe("line");

    const [, scatterNoLine] = await resolveComparisonChildren(<ExperimentComparison />, [withoutLine]);
    expect((scatterNoLine.props.data as { seriesDimension?: string }).seriesDimension).toBe("agent");

    const [, scatterExplicit] = await resolveComparisonChildren(<ExperimentComparison series="agent" />, [withLine]);
    expect((scatterExplicit.props.data as { seriesDimension?: string }).seriesDimension).toBe("agent");
  });

  it("connect 缺省跟随 series 解析:默认 line 时同 series 两点连线,默认 agent 时不连线", async () => {
    const withCost = { usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.1 } };
    const lineA = snap({ experimentId: "connect/a", agent: "codex", results: [res("q", "passed", withCost)] });
    lineA.experiment = { runs: 1, earlyExit: false, selectedEvalIds: ["q"], labels: { line: "codex" } };
    const lineB = snap({ experimentId: "connect/b", agent: "codex", results: [res("q", "failed", withCost)] });
    lineB.experiment = { runs: 1, earlyExit: false, selectedEvalIds: ["q"], labels: { line: "codex" } };
    const [, connectedScatter] = await resolveComparisonChildren(<ExperimentComparison />, [lineA, lineB]);
    expect((connectedScatter.props as unknown as { connect?: boolean }).connect).toBe(true);

    const plainA = snap({ experimentId: "connect/plain-a", agent: "codex", results: [res("q", "passed", withCost)] });
    const plainB = snap({ experimentId: "connect/plain-b", agent: "codex", results: [res("q", "failed", withCost)] });
    const [, unconnectedScatter] = await resolveComparisonChildren(<ExperimentComparison />, [plainA, plainB]);
    expect((unconnectedScatter.props as unknown as { connect?: boolean }).connect).toBe(false);
  });

  it("line 缺省对整个 Scope 生效:混入一个声明 line 的实验后,没声明的实验落 (missing) 而非回退 agent;显式 series 覆盖全部", async () => {
    const lineA = snap({ experimentId: "mem/codex-baseline", agent: "codex", results: [res("q", "passed")] });
    lineA.experiment = { runs: 1, earlyExit: false, selectedEvalIds: ["q"], labels: { line: "codex", memory: "baseline" } };
    const lineB = snap({ experimentId: "mem/codex-mempal", agent: "codex", results: [res("q", "failed")] });
    lineB.experiment = { runs: 1, earlyExit: false, selectedEvalIds: ["q"], labels: { line: "codex", memory: "mempal" } };
    const plain = snap({ experimentId: "dev/one", agent: "codex", results: [res("q", "passed")] });
    const all = [lineA, lineB, plain];

    const [, scatterEl] = await resolveComparisonChildren(<ExperimentComparison />, all);
    const scatterData = scatterEl.props.data as { seriesDimension?: string; rows: Array<{ key: string; series?: string }> };
    expect(scatterData.seriesDimension).toBe("line");
    const byKey = new Map(scatterData.rows.map((r) => [r.key, r.series]));
    expect(byKey.get("mem/codex-baseline")).toBe("codex");
    expect(byKey.get("dev/one")).toBe("(missing)");

    const [, explicitScatterEl] = await resolveComparisonChildren(<ExperimentComparison series={label("memory")} />, all);
    expect((explicitScatterEl.props.data as { seriesDimension?: string }).seriesDimension).toBe("memory");
  });

  it("纯计分制 Scope:展开树仍是扁平三元素形状,散点 y 与列表预排序引用 totalScore 同一实例(不是 endToEndPassRate)", async () => {
    const g1a = snap({
      experimentId: "score/a",
      agent: "bub",
      results: [res("q", "passed", { scoring: "points", assertions: [scoreAssertion(3)] })],
    });
    const g1b = snap({
      experimentId: "score/b",
      agent: "codex",
      results: [res("q", "passed", { scoring: "points", assertions: [scoreAssertion(2)] })],
    });
    const all = [g1a, g1b];
    const [summaryEl, scatterEl, listEl] = await resolveComparisonChildren(<ExperimentComparison />, all);
    expect(summaryEl.props.data).toEqual(await scopeSummaryData(all));
    expect(listEl.props.data).toEqual(await experimentListData(all));
    expect(scatterEl.props.data).toEqual(
      await metricScatterData(all, { points: "experiment", series: "agent", x: costUSD, y: totalScore }),
    );
  });

  it("mixed:按题型拆成两组;ScopeSummary 只有一份读整个 input,散点与 ExperimentList 各题型一对、各用各的主读数", async () => {
    const passSnap = snap({ experimentId: "mixed/pass", agent: "bub", results: [res("p", "passed")] });
    const pointsSnap = snap({
      experimentId: "mixed/points",
      agent: "codex",
      results: [res("q", "passed", { scoring: "points", assertions: [scoreAssertion(4)] })],
    });
    const scope = scopeOf([passSnap, pointsSnap]);
    const resolved = await resolveTree(<ExperimentComparison />, scope);

    const summaries = collectElementsByType(resolved, ScopeSummary);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.props.data).toEqual(await scopeSummaryData([passSnap, pointsSnap]));

    const scatters = collectElementsByType(resolved, MetricScatter);
    const lists = collectElementsByType(resolved, ExperimentList);
    expect(scatters).toHaveLength(2);
    expect(lists).toHaveLength(2);

    const scatterByY = new Map(scatters.map((el) => [(el.props.data as { y: { key: string } }).y.key, el]));
    expect(scatterByY.get(endToEndPassRate.name)?.props.data).toEqual(
      await metricScatterData([passSnap], { points: "experiment", series: "agent", x: costUSD, y: endToEndPassRate }),
    );
    expect(scatterByY.get(totalScore.name)?.props.data).toEqual(
      await metricScatterData([pointsSnap], { points: "experiment", series: "agent", x: costUSD, y: totalScore }),
    );

    const listByScoring = new Map(lists.map((el) => [(el.props.data as Array<{ scoring: string }>)[0]?.scoring, el]));
    expect(listByScoring.get("pass")?.props.data).toEqual(await experimentListData([passSnap]));
    expect(listByScoring.get("points")?.props.data).toEqual(await experimentListData([pointsSnap]));
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

  it("extends 只收 defineReport 产物;与 content/pages 多选或全省略按完整用户反馈报错", () => {
    // @ts-expect-error 非 defineReport 产物,类型层已拒绝;这里模拟无类型 JS 输入
    expect(() => defineReport({ extends: {} })).toThrow(/must be a defineReport\(\.\.\.\) product/);
    // @ts-expect-error extends 与 pages 互斥
    expect(() => defineReport({ extends: standard, pages: standard.pages })).toThrow(/declare exactly one/);
    // @ts-expect-error content / pages / extends 至少声明一个
    expect(() => defineReport({ title: "x" })).toThrow(/niceeval\/report\/built-in/);
  });
});
