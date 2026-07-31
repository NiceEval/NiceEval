// cases: docs/engineering/testing/unit/reports.md
// 管线测试(resolve/validate/装载规范化):spec/data 双形态严格等价、记忆化、组合组件递归展开、
// 同层并行保序、非法节点拒绝、defineReport 三种写法与外壳嵌套的装载规范化、标题回退链、
// 内建报告的结构与具名导出同引用、组合组件(FailureList / ExperimentScatter /
// ExperimentTable / SampleOverview)与手写组合的
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
import type { AttemptHandle, Record, Sample, Run } from "../../record/index.ts";
import type { AttemptLocator } from "../../record/locator.ts";
import { attemptHandleOf, resultsOf, scopeOf } from "../components/scope.harness.ts";
import {
  createTextContext,
  defineComponent,
  renderNodeToText,
  resolveReportTree,
  validateReportTree,
  ResolveMemo,
  type ReportNode,
} from "../definition/tree.ts";
import {
  buildReportMeta,
  defineReport,
  FALLBACK_REPORT_TITLE,
  resolveReportTitle,
  type NonEmptyArray,
  type PageDefinitionInput,
  type ReportPage,
} from "../definition/report.ts";
import { pickReportPage, ReportPageNeedsLocatorError, ReportPageNotFoundError } from "./text.ts";
import { renderSamplePage } from "./page-render.ts";
import { ExperimentTable, FailureList } from "../components/entity-lists/index.tsx";
import { Hero } from "../components/site-components/index.tsx";
import { ExperimentScatter, SampleOverview, SampleSummary } from "../components/summaries/index.tsx";
import { Chart, Col, CopyBlock, Callouts, Grid, Section, Series, Stat, Tab, Table, Tabs, Text, Waterfall } from "../definition/primitives.tsx";
import { pointsToDataset } from "../definition/primitives/points-dataset.ts";
import { attemptListData } from "../components/entity-lists/compute.ts";
import { attemptListContent, experimentListContent } from "../components/entity-lists/content.ts";
import { scopeSummaryData } from "../components/summaries/compute.ts";
import { AttemptDetails } from "../components/attempt-detail/index.tsx";
import {
  agent,
  aggregate,
  costUSD,
  experiment,
  passRate,
  totalScore,
  type GroupFunction,
} from "../model/calculation.ts";
import { label } from "../model/flag.ts";
import { toExperimentRows } from "../model/conversions.ts";
import builtInReport, { failures, stability, standard, standardAttemptPage } from "../built-in/index.tsx";
import { RunNotices, SampleFixPrompt, SampleNotices } from "../components/site-components/index.tsx";
import { StabilityOverview } from "../components/summaries/index.tsx";
import { loadBuiltInReport } from "./load.ts";

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
  name?: Run["name"];
  runStartedAt?: string;
}): Run {
  runSeq += 1;
  const startedAt = spec.runStartedAt ?? `2026-06-01T00:00:00.${String(runSeq).padStart(3, "0")}Z`;
  const run = {
    experimentId: spec.experimentId,
    startedAt,
    completedAt: startedAt,
    agent: spec.agent ?? "agent-x",
    model: spec.model,
    name: spec.name,
    schemaVersion: 1,
    dir: `/results/exp/snap-${runSeq}`,
  } as Run;
  const attempts: AttemptHandle[] = spec.results.map((r) =>
    attemptHandleOf(run, r, {
      run: `exp/snap-${runSeq}`,
      attempt: `${r.id}/a${r.attempt}`,
    }),
  );
  const evals = new Map<string, AttemptHandle[]>();
  for (const attempt of attempts) evals.set(attempt.evalId, [...(evals.get(attempt.evalId) ?? []), attempt]);
  run.evals = [...evals.entries()].map(([id, list]) => ({ id, attempts: list }));
  run.attempts = attempts;
  return run;
}

async function pageTree(page: ReportPage, scope: Sample): Promise<ReportNode> {
  return renderSamplePage(page, scope);
}

/**
 * 管线便捷入口:装载 + 挑页 + render + resolve + validate,不渲染——断言面是解析后的树结构
 * (元素 type / props)或抛出的错误对象。裸字符串 / 非法节点这类只在 validate 阶段
 * 才拒绝的输入,同样会在这里抛出(validateReportTree 紧跟 resolve 之后调用)。
 */
async function resolveTree(node: ReportNode, scope: Sample): Promise<ReportNode> {
  const definition = defineReport(() => node);
  const page = pickReportPage(definition);
  const tree = await renderSamplePage(page, scope);
  const resolved = await resolveReportTree(tree, {
    scope,
    results: resultsOf(scope.runs),
    report: buildReportMeta(definition, scope),
    page: { id: page.id, input: "sample" },
    memo: new ResolveMemo(),
  });
  validateReportTree(resolved);
  return resolved;
}

function collectElementsByType(
  node: unknown,
  target: unknown,
  out: Array<{ props: globalThis.Record<string, unknown> }> = [],
): Array<{ props: globalThis.Record<string, unknown> }> {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectElementsByType(child, target, out);
    return out;
  }
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type === target) out.push(el as { props: globalThis.Record<string, unknown> });
  if (el.props && "children" in el.props) collectElementsByType(el.props.children, target, out);
  return out;
}

async function expectSnapshotStats(resolved: unknown, scope: Sample) {
  const expected = await scopeSummaryData(scope);
  const stats = collectElementsByType(resolved, Stat);
  expect(stats.some((s) => s.props.value === expected.experiments)).toBe(true);
  expect(stats.some((s) => s.props.value === expected.evals)).toBe(true);
  expect(stats.some((s) => s.props.value === expected.attempts)).toBe(true);
}

// ───────────────────────── spec / data 双形态 ─────────────────────────


// ───────────────────────── 组合组件与树形状 ─────────────────────────


// ───────────────────────── FailureList ─────────────────────────

describe("FailureList", () => {
  it("与手写组合(attemptListData → 过滤 → 排序 → 截断)严格等价:failed/errored、开始时间降序、limit 截断且 total 报截断前总数", async () => {
    const s = snap({
      experimentId: "fail/a",
      results: [
        res("q1", "failed", { startedAt: "2026-07-01T01:00:00.000Z" }),
        res("q2", "errored", {
          startedAt: "2026-07-01T03:00:00.000Z",
          error: { code: "x", message: "boom", origin: { scope: "attempt" as const, phase: "eval.run" } },
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

    const props = (resolved as unknown as { props: { data: unknown } }).props;
    expect(props.data).toEqual(attemptListContent(failures.slice(0, 2)));
  });

  it("失败数少于 limit 时不截断行", async () => {
    const s = snap({ experimentId: "fail/few", results: [res("q1", "failed")] });
    const resolved = await resolveTree(<FailureList />, scopeOf([s]));
    const props = (resolved as unknown as { props: { data: { rows: unknown[] } } }).props;
    expect(props.data.rows).toHaveLength(1);
  });
});

// ───────────────────────── Table 装载校验 ─────────────────────────

describe("Table 装载校验", () => {
  it("普通 rows 缺少已声明字段时给出完整路径", () => {
    const ctx = createTextContext({ width: 100 });
    expect(() =>
      renderNodeToText(
        <Table columns={["answer"]} rows={[{}]} />,
        ctx,
      ),
    ).toThrow(/rows\[0\]\.answer is missing/);
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
  it("单页函数缩写与 pages [{id: report, render}] 装载出等价的规范化结果", async () => {
    const scope = scopeOf([]);
    const tree = <SampleSummary />;
    const fromFn = defineReport(() => tree);
    const fromPages = defineReport({
      pages: [{ id: "report", title: { en: "Report", "zh-CN": "报告" }, render: () => tree }],
    });
    for (const definition of [fromFn, fromPages]) {
      expect(definition.kind).toBe("report");
      expect(definition.pages).toHaveLength(1);
      expect(definition.pages[0]!.id).toBe("report");
      expect(await renderSamplePage(definition.pages[0]!, scope)).toBe(tree);
    }
    expect(fromFn.pages[0]!.title).toEqual(fromPages.pages[0]!.title);
  });

  it("pages 为空或全省略,装载报错且文案给出 built-in 下一步", () => {
    expect(() => defineReport({ pages: [] } as never)).toThrow(/non-empty array/);
    expect(() => defineReport({ title: "X" } as never)).toThrow(/niceeval\/report\/built-in/);
  });

  it("defineReport 产物不是 ReportNode:页 render 返回外壳产物时树校验拒绝", async () => {
    const inner = defineReport(() => <SampleSummary />);
    expect(() => defineReport(inner as never)).toThrow(/shell cannot nest/);
    expect(() => validateReportTree([inner] as never)).toThrow(/not a report node/);
    const definition = defineReport({
      pages: [{ id: "a", title: "A", render: () => inner as never }],
    });
    const scope = scopeOf([]);
    await expect(resolveTree(await renderSamplePage(definition.pages[0]!, scope), scope)).rejects.toThrow(
      /shell cannot nest|not a report component|not a report node/,
    );
  });

  it("重复或非法 page id 装载报错并点名冲突;LocalizedText 全空对象报错", () => {
    expect(() =>
      defineReport({
        pages: [
          { id: "exam", title: "A", render: () => null },
          { id: "exam", title: "B", render: () => null },
        ],
      }),
    ).toThrow(/"exam" is declared twice/);
    expect(() => defineReport({ pages: [{ id: "Bad/Id", title: "A", render: () => null }] })).toThrow(/invalid/);
    expect(() => defineReport({ title: {}, pages: [{ id: "report", title: "R", render: () => null }] })).toThrow(
      /no non-empty value/,
    );
  });

  const dummyParams = {
    encode: (p: { locator: string }) => p.locator,
    decode: (key: string) => ({ locator: key }),
    enumerate: () => [],
  };

  it("page 省略 params 规范化为 navigation:true;声明 params 必须同时声明 load 且 navigation:false", () => {
    const definition = defineReport({
      pages: [
        { id: "report", title: "Report", render: () => null },
        {
          id: "attempt",
          title: "Attempt",
          params: dummyParams,
          load: (_base, p: { locator: string }) => p,
          navigation: false,
          render: () => null,
        },
      ],
    });
    expect(definition.pages[0]).toMatchObject({ navigation: true });
    expect(definition.pages[0]!.params).toBeUndefined();
    expect(definition.pages[1]).toMatchObject({ navigation: false });
    expect(definition.pages[1]!.params).toBe(dummyParams);

    expect(() =>
      defineReport({
        pages: [{ id: "a", title: "A", params: dummyParams, render: () => null }],
      } as never),
    ).toThrow(/declares params but no load/);
    expect(() =>
      defineReport({
        pages: [
          { id: "a", title: "A", params: dummyParams, load: (_b: unknown, p: unknown) => p, render: () => null },
        ],
      } as never),
    ).toThrow(/declares params but not navigation: false/);
    expect(() =>
      defineReport({
        pages: [
          {
            id: "a",
            title: "A",
            params: dummyParams,
            load: (_b: unknown, p: unknown) => p,
            navigation: true,
            render: () => null,
          },
        ],
      } as never),
    ).toThrow(/declares params but not navigation: false/);
  });

  it("navigation: false 的普通 page 不进导航但仍是普通 page(没有 params)", () => {
    const definition = defineReport({
      pages: [
        { id: "report", title: "Report", render: () => null },
        { id: "hidden", title: "Hidden", navigation: false, render: () => null },
      ],
    });
    expect(definition.pages[1]).toMatchObject({ navigation: false });
    expect(definition.pages[1]!.params).toBeUndefined();
  });

  it("一份 report 可以声明多张参数化页(不再有「至多一张」限制)", () => {
    const definition = defineReport({
      pages: [
        {
          id: "a1",
          title: "A1",
          params: dummyParams,
          load: (_b: unknown, p: unknown) => p,
          navigation: false,
          render: () => null,
        },
        {
          id: "a2",
          title: "A2",
          params: dummyParams,
          load: (_b: unknown, p: unknown) => p,
          navigation: false,
          render: () => null,
        },
      ],
    });
    expect(definition.pages.map((p) => p.id)).toEqual(["a1", "a2"]);
  });

  it("LEGACY 外壳字段 links/footer/scripts/styles 装载报错", () => {
    const empty = { pages: [{ id: "report", title: "R", render: () => null }] } as const;
    expect(() => defineReport({ ...empty, links: [] } as never)).toThrow(/no longer accepts LEGACY "links"/);
    expect(() => defineReport({ ...empty, scripts: [{ src: "../x.js" }] } as never)).toThrow(/no longer accepts LEGACY "scripts"/);
    expect(() => defineReport({ ...empty, styles: [{ inline: "x" }] } as never)).toThrow(/no longer accepts LEGACY "styles"/);
    expect(() => defineReport({ ...empty, footer: "x" } as never)).toThrow(/no longer accepts LEGACY "footer"/);
  });

  it("--page 语义:pickReportPage 缺省第一页,未命中抛 ReportPageNotFoundError 列出可用页", () => {
    const definition = defineReport({
      pages: [
        { id: "overview", title: "Overview", render: () => null },
        { id: "exam", title: "Exam", render: () => null },
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
    // 单页函数缩写展开出的唯一页 id 是 report
    const single = defineReport(() => <SampleSummary />);
    expect(pickReportPage(single, "report").id).toBe("report");
  });

  it("pickReportPage 缺省跳过 navigation:false 的页,只挑第一张可导航页;可用列表也只含可导航页", () => {
    const definition = defineReport({
      pages: [
        { id: "hidden", title: "Hidden", navigation: false, render: () => null },
        { id: "overview", title: "Overview", render: () => null },
        {
          id: "attempt",
          title: "Attempt",
          params: dummyParams,
          load: (_b: unknown, p: unknown) => p,
          navigation: false,
          render: () => null,
        },
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

  it("显式选择参数化 page 但没有 params:ReportPageNeedsLocatorError", () => {
    const definition = defineReport({
      pages: [
        { id: "report", title: "Report", render: () => null },
        {
          id: "attempt",
          title: "Attempt",
          params: dummyParams,
          load: (_b: unknown, p: unknown) => p,
          navigation: false,
          render: () => null,
        },
      ],
    });
    expect(() => pickReportPage(definition, "attempt")).toThrow(ReportPageNeedsLocatorError);
  });

  it("标题回退链:def.title → 唯一且相同的快照 name → 内置文案「Eval 运行结果 / Eval Record」;en 相同 zh 不同也落内置文案", () => {
    const named = snap({ experimentId: "t/a", name: "Memory Evals", results: [res("q", "passed")] });
    const definition = defineReport(() => <SampleSummary />);
    expect(
      resolveReportTitle(defineReport({ title: "Custom", pages: [{ id: "report", title: "R", render: () => null }] }), scopeOf([named])),
    ).toBe("Custom");
    expect(resolveReportTitle(definition, scopeOf([named]))).toBe("Memory Evals");
    expect(resolveReportTitle(definition, scopeOf([snap({ experimentId: "t/b", results: [] })]))).toEqual(
      FALLBACK_REPORT_TITLE,
    );
    const zhA = snap({ experimentId: "t/c", name: { en: "Same", "zh-CN": "一" }, results: [] });
    const zhB = snap({ experimentId: "t/d", name: { en: "Same", "zh-CN": "二" }, results: [] });
    expect(resolveReportTitle(definition, scopeOf([zhA, zhB]))).toEqual(FALLBACK_REPORT_TITLE);
    expect(FALLBACK_REPORT_TITLE).toEqual({ en: "Eval Record", "zh-CN": "Eval 运行结果" });
  });
});

// ───────────────────────── 内建报告 ─────────────────────────

describe("内建报告", () => {
  it("四页普通 defineReport:页 id、页名与逐页组件构成和 built-in.md 全文一致,第四页是不进导航的 attempt-input page", async () => {
    const scope = scopeOf([]);
    expect(builtInReport.kind).toBe("report");
    expect(builtInReport.pages.map((p) => p.id)).toEqual(["report", "attempts", "traces", "attempt"]);
    expect(builtInReport.pages.map((p) => p.title)).toEqual([
      { en: "Report", "zh-CN": "报告" },
      "Attempts",
      { en: "Traces", "zh-CN": "追踪" },
      "Attempt",
    ]);
    const childTypes = (content: unknown) => {
      const col = content as {
        type: unknown;
        props: { children: Array<{ type: unknown; props: globalThis.Record<string, unknown> } | null | false | undefined> };
      };
      expect(col.type).toBe(Col);
      return col.props.children.filter((c): c is { type: unknown; props: globalThis.Record<string, unknown> } =>
        c !== null && c !== undefined && typeof c === "object",
      );
    };
    const [reportPage, attemptsPage, tracesPage, attemptPage] = builtInReport.pages;
    expect(childTypes(await pageTree(reportPage!, scope)).map((c) => c.type)).toEqual([
      Hero,
      Callouts,
      Callouts,
      SampleOverview,
    ]);
    // 首页在无可复制 fix prompt 时不挂 CopyBlock；有失败时才会多一节。
    const attemptsChildren = childTypes(await pageTree(attemptsPage!, scope));
    expect(attemptsChildren.map((c) => c.type)).toEqual([Hero, Callouts, Callouts, SampleOverview]);
    expect(childTypes(await pageTree(tracesPage!, scope)).map((c) => c.type)).toEqual([Hero, Callouts, Callouts, Waterfall]);
    expect(attemptPage!.render).toBe(standardAttemptPage.render);
    expect(attemptPage).toMatchObject({
      id: standardAttemptPage.id,
      title: standardAttemptPage.title,
      navigation: false,
    });
    expect(attemptPage!.params).toBe(standardAttemptPage.params);
    expect(((await attemptPage!.render(null as never)) as { type: unknown }).type).toBe(AttemptDetails);
  });

  it("任务视图 failures / stability:单导航页构成与 built-in.md 全文一致,详情页复用 standardAttemptPage", async () => {
    const scope = scopeOf([]);
    const childTypes = (content: unknown) => {
      const col = content as { type: unknown; props: { children: Array<{ type: unknown; props: globalThis.Record<string, unknown> }> } };
      expect(col.type).toBe(Col);
      return col.props.children;
    };
    for (const view of [failures, stability]) {
      expect(view.kind).toBe("report");
      expect(view.pages).toHaveLength(2);
      expect(view.pages[1]!.render).toBe(standardAttemptPage.render);
      expect(view.pages[1]).toMatchObject({
        id: standardAttemptPage.id,
        title: standardAttemptPage.title,
        navigation: false,
      });
      expect(view.pages[1]!.params).toBe(standardAttemptPage.params);
    }
    expect(failures.pages[0]!.id).toBe("failures");
    expect(failures.pages[0]!.title).toEqual({ en: "Failures", "zh-CN": "失败" });
    const failureChildren = childTypes(await pageTree(failures.pages[0]!, scope));
    expect(failureChildren.map((c) => c.type)).toEqual([Hero, SampleNotices, RunNotices, FailureList, SampleFixPrompt]);
    expect(failureChildren[3]!.props.limit).toBe(50);
    expect(stability.pages[0]!.id).toBe("stability");
    expect(stability.pages[0]!.title).toEqual({ en: "Stability", "zh-CN": "稳定性" });
    expect(childTypes(await pageTree(stability.pages[0]!, scope)).map((c) => c.type)).toEqual([
      Hero,
      SampleNotices,
      RunNotices,
      StabilityOverview,
    ]);
  });

  it("视图名表:三个裸词各命中具名导出同引用,未知名报错列出全部可用名字", async () => {
    await expect(loadBuiltInReport("standard")).resolves.toBe(standard);
    await expect(loadBuiltInReport("failures")).resolves.toBe(failures);
    await expect(loadBuiltInReport("stability")).resolves.toBe(stability);
    await expect(loadBuiltInReport("nope")).rejects.toThrow(/standard, failures, stability/);
  });

  it("standardAttemptPage.params 往返:decode(encode(p)) 与 p 深相等;enumerate 给出全部 locator", () => {
    const run = snap({ experimentId: "exp/a", results: [res("q", "passed")] });
    const withLocator = attemptHandleOf(run, run.attempts[0]!.result, run.attempts[0]!.ref, {
      locator: "@1abcdefg" as AttemptLocator,
    });
    run.attempts = [withLocator];
    const scope = scopeOf([run]);
    const p = { locator: withLocator.locator! };
    expect(standardAttemptPage.params!.decode(standardAttemptPage.params!.encode(p))).toEqual(p);
    const enumerated = [...standardAttemptPage.params!.enumerate(scope)];
    expect(enumerated).toEqual([{ locator: withLocator.locator }]);
  });
});

// ───────────────────────── SampleOverview(组合组件)─────────────────────────

describe("SampleOverview(组合组件)", () => {
  /** 展开树里 [SampleSummary, Chart, Table] 三个已解析元素。 */
  async function resolveComparisonChildren(
    node: ReportNode,
    runs: Run[],
  ): Promise<Array<{ props: { data: unknown } }>> {
    const scope = scopeOf(runs);
    const definition = defineReport(() => node);
    const page = pickReportPage(definition);
    const tree = await renderSamplePage(page, scope);
    const resolved = (await resolveReportTree(tree, {
      scope,
      results: resultsOf(runs),
      report: buildReportMeta(definition, scope),
      page: { id: page.id, input: "sample" },
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
    out: Array<{ props: globalThis.Record<string, unknown> }> = [],
  ): Array<{ props: globalThis.Record<string, unknown> }> {
    if (node === null || node === undefined || typeof node !== "object") return out;
    if (Array.isArray(node)) {
      for (const child of node) collectElementsByType(child, target, out);
      return out;
    }
    const el = node as { type?: unknown; props?: { children?: unknown } };
    if (el.type === target) out.push(el as { props: globalThis.Record<string, unknown> });
    if (el.props && "children" in el.props) collectElementsByType(el.props.children, target, out);
    return out;
  }

  async function overviewPoints(
    sample: Sample,
    options: { seriesKey: string; seriesFn: GroupFunction; y: "passRate" | "totalScore" },
  ) {
    const yCalc = options.y === "totalScore" ? totalScore : passRate;
    return aggregate(sample, {
      by: { experiment, [options.seriesKey]: options.seriesFn },
      values: { costUSD, [options.y]: yCalc },
    });
  }

  it("不同深度目录的 experiments 一律进同一份散点与层级实验表", async () => {
    const g1a = snap({ experimentId: "compare/a", agent: "bub", results: [res("q", "passed")] });
    const g1b = snap({ experimentId: "compare/b", agent: "codex", results: [res("q", "failed")] });
    const g2 = snap({ experimentId: "bench/long/x", results: [res("q", "passed")] });
    const solo = snap({ experimentId: "standalone", results: [res("q", "failed")] });
    const all = [g1a, g1b, g2, solo];
    const scope = scopeOf(all);
    const resolved = await resolveTree(<SampleOverview />, scope);
    const charts = collectElementsByType(resolved, Chart);
    const tables = collectElementsByType(resolved, Table);
    expect(tables).toHaveLength(1);
    expect(charts).toHaveLength(1);
    const points = await overviewPoints(scope, { seriesKey: "agent", seriesFn: agent, y: "passRate" });
    const details = experimentListContent(await toExperimentRows(scope));
    expect(tables[0]!.props.data).toEqual(details);
    expect(details.rows.every((row) => (row.subRows?.length ?? 0) > 0)).toBe(true);
    expect(charts[0]!.props.data).toEqual(
      pointsToDataset(points as readonly globalThis.Record<string, unknown>[], {
        x: "costUSD",
        y: "passRate",
        point: "experiment",
        series: "agent",
      }),
    );
  });

  it("series 缺省解析:Sample 内任一 experiment 声明 labels.line 时 Series.by=line,完全无 line 时 agent;显式 series 覆盖缺省", async () => {
    const withCost = { usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.1 } };
    const withLine = snap({ experimentId: "series/with-line", results: [res("q", "passed", withCost)] });
    withLine.experiment = { attempts: 1, earlyExit: false, selectedEvalIds: ["q"], labels: { line: "codex" } };
    const withoutLine = snap({ experimentId: "series/plain", results: [res("q", "passed", withCost)] });

    const seriesByOf = (node: unknown): string | undefined => {
      const charts = collectElementsByType(node, Chart);
      const visit = (n: unknown): string | undefined => {
        if (n === null || n === undefined || typeof n !== "object") return undefined;
        if (Array.isArray(n)) {
          for (const c of n) {
            const found = visit(c);
            if (found !== undefined) return found;
          }
          return undefined;
        }
        const el = n as { props?: { by?: string; mark?: string; children?: unknown } };
        if (el.props?.mark === "scatter" && typeof el.props.by === "string") return el.props.by;
        if (el.props && "children" in el.props) return visit(el.props.children);
        return undefined;
      };
      return visit(charts[0]?.props.children);
    };

    expect(seriesByOf(await resolveTree(<SampleOverview />, scopeOf([withLine, withoutLine])))).toBe("line");
    expect(seriesByOf(await resolveTree(<SampleOverview />, scopeOf([withoutLine])))).toBe("agent");
    expect(seriesByOf(await resolveTree(<SampleOverview series="agent" />, scopeOf([withLine])))).toBe("agent");
  });

  it("connect 缺省跟随 series 解析:默认 line 时同 series 两点连线,默认 agent 时不连线", async () => {
    const withCost = { usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.1 } };
    const lineA = snap({ experimentId: "connect/a", agent: "codex", results: [res("q", "passed", withCost)] });
    lineA.experiment = { attempts: 1, earlyExit: false, selectedEvalIds: ["q"], labels: { line: "codex" } };
    const lineB = snap({ experimentId: "connect/b", agent: "codex", results: [res("q", "failed", withCost)] });
    lineB.experiment = { attempts: 1, earlyExit: false, selectedEvalIds: ["q"], labels: { line: "codex" } };

    const connectOf = async (node: unknown): Promise<boolean | undefined> => {
      const charts = collectElementsByType(node, Chart);
      const visit = (n: unknown): boolean | undefined => {
        if (n === null || n === undefined || typeof n !== "object") return undefined;
        if (Array.isArray(n)) {
          for (const c of n) {
            const found = visit(c);
            if (found !== undefined) return found;
          }
          return undefined;
        }
        const el = n as { props?: { connect?: boolean; mark?: string; children?: unknown } };
        if (el.props?.mark === "scatter" && typeof el.props.connect === "boolean") return el.props.connect;
        if (el.props && "children" in el.props) return visit(el.props.children);
        return undefined;
      };
      return visit(charts[0]?.props.children);
    };

    expect(await connectOf(await resolveTree(<SampleOverview />, scopeOf([lineA, lineB])))).toBe(true);
    const plainA = snap({ experimentId: "connect/plain-a", agent: "codex", results: [res("q", "passed", withCost)] });
    const plainB = snap({ experimentId: "connect/plain-b", agent: "codex", results: [res("q", "failed", withCost)] });
    expect(await connectOf(await resolveTree(<SampleOverview />, scopeOf([plainA, plainB])))).toBe(false);
  });

  it("line 缺省对整个 Sample 生效:混入一个声明 line 的实验后,没声明的实验落 (missing) 而非回退 agent;显式 series 覆盖全部", async () => {
    const lineA = snap({ experimentId: "mem/codex-baseline", agent: "codex", results: [res("q", "passed")] });
    lineA.experiment = { attempts: 1, earlyExit: false, selectedEvalIds: ["q"], labels: { line: "codex", memory: "baseline" } };
    const lineB = snap({ experimentId: "mem/codex-mempal", agent: "codex", results: [res("q", "failed")] });
    lineB.experiment = { attempts: 1, earlyExit: false, selectedEvalIds: ["q"], labels: { line: "codex", memory: "mempal" } };
    const plain = snap({ experimentId: "dev/one", agent: "codex", results: [res("q", "passed")] });
    const all = [lineA, lineB, plain];

    const charts = collectElementsByType(await resolveTree(<SampleOverview />, scopeOf(all)), Chart);
    const dataset = charts[0]!.props.data as {
      fields: Array<{ name: string }>;
      rows: Array<{ values: globalThis.Record<string, string> }>;
    };
    expect(dataset.fields.some((f) => f.name === "line")).toBe(true);
    const byKey = new Map(dataset.rows.map((r) => [r.values.experiment as string, r.values.line]));
    expect(byKey.get("mem/codex-baseline")).toBe("codex");
    expect(byKey.get("dev/one")).toBe("(missing)");

    const explicitCharts = collectElementsByType(
      await resolveTree(<SampleOverview series={label("memory")} />, scopeOf(all)),
      Chart,
    );
    const explicit = explicitCharts[0]!.props.data as { fields: Array<{ name: string }> };
    expect(explicit.fields.some((f) => f.name === "memory")).toBe(true);
  });

  it("纯计分制 Sample:散点 y 用 totalScore，实验表显示同一 Sample 的层级详情", async () => {
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
    const scope = scopeOf(all);
    const resolved = await resolveTree(<SampleOverview />, scope);
    const charts = collectElementsByType(resolved, Chart);
    const tables = collectElementsByType(resolved, Table);
    const points = await overviewPoints(scope, { seriesKey: "agent", seriesFn: agent, y: "totalScore" });
    expect(tables[0]!.props.data).toEqual(experimentListContent(await toExperimentRows(scope)));
    expect(charts[0]!.props.data).toEqual(
      pointsToDataset(points as readonly globalThis.Record<string, unknown>[], {
        x: "costUSD",
        y: "totalScore",
        point: "experiment",
        series: "agent",
      }),
    );
    expect((charts[0]!.props as { y?: string }).y).toBe("totalScore");
  });

  it("mixed:散点按题型拆成两张图，实验详情仍是一张统一层级表", async () => {
    const passSnap = snap({ experimentId: "mixed/pass", agent: "bub", results: [res("p", "passed")] });
    const pointsSnap = snap({
      experimentId: "mixed/points",
      agent: "codex",
      results: [res("q", "passed", { scoring: "points", assertions: [scoreAssertion(4)] })],
    });
    const scope = scopeOf([passSnap, pointsSnap]);
    const resolved = await resolveTree(<SampleOverview />, scope);

    const charts = collectElementsByType(resolved, Chart);
    const lists = collectElementsByType(resolved, Table);
    expect(charts).toHaveLength(2);
    expect(lists).toHaveLength(1);

    const chartByY = new Map(charts.map((el) => [(el.props as { y?: string }).y, el]));
    const passPoints = await overviewPoints(scopeOf([passSnap]), {
      seriesKey: "agent",
      seriesFn: agent,
      y: "passRate",
    });
    const scorePoints = await overviewPoints(scopeOf([pointsSnap]), {
      seriesKey: "agent",
      seriesFn: agent,
      y: "totalScore",
    });
    expect(chartByY.get("passRate")?.props.data).toEqual(
      pointsToDataset(passPoints as readonly globalThis.Record<string, unknown>[], {
        x: "costUSD",
        y: "passRate",
        point: "experiment",
        series: "agent",
      }),
    );
    expect(chartByY.get("totalScore")?.props.data).toEqual(
      pointsToDataset(scorePoints as readonly globalThis.Record<string, unknown>[], {
        x: "costUSD",
        y: "totalScore",
        point: "experiment",
        series: "agent",
      }),
    );

    expect(lists[0]!.props.data).toEqual(experimentListContent(await toExperimentRows(scope)));
  });

  it("SampleOverview 严格等价于摘要、实验散点与实验详情表的手写组合", async () => {
    const scope = scopeOf([
      snap({ experimentId: "compare/a", results: [res("q", "passed")] }),
      snap({ experimentId: "compare/b", results: [res("q", "failed")] }),
    ]);
    const Handwritten = defineComponent(() => (
      <Col>
        <SampleSummary />
        <ExperimentScatter />
        <ExperimentTable />
      </Col>
    ));
    expect(await resolveTree(<SampleOverview />, scope)).toEqual(await resolveTree(<Handwritten />, scope));
  });
});

// ───────────────────────── 内建视图集合与页复用 ─────────────────────────

describe("内建视图集合与页复用", () => {
  it("内建入口是视图集合:默认导出与具名导出 standard 同引用", () => {
    expect(builtInReport).toBe(standard);
  });

  it("复用内建页是普通数组展开:取到的页逐项同引用,外壳只认本报告自己声明的字段", async () => {
    const scope = scopeOf([]);
    const branded = defineReport({
      pages: [...standard.pages] as NonEmptyArray<(typeof standard.pages)[number]>,
      title: "Memory Evals",
    });
    branded.pages.forEach((page, i) => expect(page).toEqual(standard.pages[i]));
    branded.pages.forEach((page, i) => expect(page.render).toBe(standard.pages[i]!.render));
    expect(branded.title).toBe("Memory Evals");
    expect(branded.head).toEqual([]);

    const s = snap({ experimentId: "compare/a", results: [res("q", "passed")] });
    expect(buildReportMeta(branded, scopeOf([s])).title).toBe("Memory Evals");
    await pageTree(branded.pages[0]!, scope);
  });

  it("挑页与换页也是普通数组操作:过滤掉一张再拼上自己的,顺序即声明顺序", async () => {
    const scope = scopeOf([]);
    const myContent = <Text>我自己的总览</Text>;
    const mine = { id: "report", title: "报告", render: () => myContent } as const;
    const composed = defineReport({
      pages: [mine, ...standard.pages.filter((page) => page.id !== "report")] as NonEmptyArray<PageDefinitionInput>,
      title: "Memory Evals",
    });
    expect(await renderSamplePage(composed.pages[0]!, scope)).toBe(myContent);
    expect(composed.pages.map((page) => page.id)).toEqual([
      "report",
      ...standard.pages.filter((page) => page.id !== "report").map((page) => page.id),
    ]);
  });

  it("extends 已移除:命中它按完整用户反馈报错并给出改写指引,不静默忽略", () => {
    // @ts-expect-error extends 不再是合法字段;这里模拟旧写法与无类型 JS 输入
    expect(() => defineReport({ extends: standard, title: "x" })).toThrow(/no longer takes "extends"/);
    // @ts-expect-error 同上:报错要指出改写成 pages 展开
    expect(() => defineReport({ extends: standard })).toThrow(/pages: \[myPage, \.\.\.standard\.pages\]/);
  });

  it("缺少 pages 或非法顶层字段按完整用户反馈报错", () => {
    // @ts-expect-error pages 必填
    expect(() => defineReport({ title: "x" })).toThrow(/niceeval\/report\/built-in/);
    expect(() => defineReport({ content: null } as never)).toThrow(/no longer accepts LEGACY "content"/);
    expect(() =>
      defineReport({
        pages: [{ id: "report", title: "R", content: null } as never],
      }),
    ).toThrow(/LEGACY "content"/);
  });
});
