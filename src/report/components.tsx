// 官方双面组件的装配点:web 面(./react/ 的纯 React 组件)+ text 面(./text/faces.ts)
// + 挂在组件上的 data 计算函数。faces 两键必填 —— 配对是结构义务,不是配对表;
// MetricBars.data 就是 MetricMatrix.data(同一份矩阵数据的另一种摆法),别名显式化。
//
// 官方组件在宿主里自动接上证据室:web 面的 attemptHref 缺省取 ctx.attemptHref
// (宿主注入的证据室深链);显式传 prop 可覆盖(嵌进自己应用时自定去处)。三个实体列表
// (ExperimentList / EvalList / AttemptList)没有这个覆盖口子——它们的 locator 徽标恒经
// ctx.attemptHref / ctx.attemptCommand,不接受 attemptHref/attemptCommand prop(docs/feature/reports/library.md
// 「嵌入自己的 React 页面」的函数签名没有这个参数),证据室深链在这三个组件上不是可选行为。

import { defineComponent, isHostWebContextActive } from "./tree.ts";
import type { ReportComponent } from "./tree.ts";
import type { ReportLocale } from "./locale.ts";
import type { AttemptLocator } from "../results/locator.ts";
import type { Selection } from "../results/types.ts";
import type {
  AttemptListItem,
  DeltaData,
  EvalListItem,
  ExperimentListItem,
  GroupSummaryData,
  LineData,
  MatrixData,
  OverviewData,
  ScatterData,
  ScoreboardData,
  TableData,
} from "./types.ts";
import {
  attemptListData,
  deltaData,
  evalListData,
  experimentListData,
  groupSummaryData,
  lineData,
  matrixData,
  overviewData,
  scatterData,
  scoreboardData,
  tableData,
} from "./compute.ts";
import type { ScatterDataOptions } from "./compute.ts";
import {
  attemptListText,
  barsText,
  deltaText,
  evalListText,
  experimentListText,
  groupSummaryText,
  lineText,
  matrixText,
  overviewText,
  scatterText,
  scoreboardText,
  tableText,
} from "./text/faces.ts";
import { RunOverview as RunOverviewWeb } from "./react/RunOverview.tsx";
import { GroupSummary as GroupSummaryWeb } from "./react/GroupSummary.tsx";
import { ExperimentList as ExperimentListWeb } from "./react/ExperimentList.tsx";
import { EvalList as EvalListWeb } from "./react/EvalList.tsx";
import { AttemptList as AttemptListWeb } from "./react/AttemptList.tsx";
import { MetricTable as MetricTableWeb } from "./react/MetricTable.tsx";
import { MetricMatrix as MetricMatrixWeb } from "./react/MetricMatrix.tsx";
import { MetricBars as MetricBarsWeb } from "./react/MetricBars.tsx";
import { Scoreboard as ScoreboardWeb } from "./react/Scoreboard.tsx";
import { MetricScatter as MetricScatterWeb } from "./react/MetricScatter.tsx";
import { MetricLine as MetricLineWeb } from "./react/MetricLine.tsx";
import { DeltaTable as DeltaTableWeb } from "./react/DeltaTable.tsx";

// ───────────────────────── props ─────────────────────────

export interface RunOverviewProps {
  data: OverviewData;
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

export interface GroupSummaryProps {
  data: GroupSummaryData;
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

/**
 * 三个实体列表都只收算好的 `items`(`.data(selection)` 的产物,报告作者先 `.filter()`/
 * `.slice()` 再传入)——没有 selection-form,组件不提供另一套过滤 DSL
 * (docs/feature/reports/library.md「实体列表」)。
 */
export interface ExperimentListProps {
  items: ExperimentListItem[];
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

export interface EvalListProps {
  items: EvalListItem[];
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

export interface AttemptListProps {
  items: AttemptListItem[];
  /** items 被 slice 时如实显示剩余数量;省略即 items.length(未截断)。 */
  total?: number;
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

export interface MetricTableProps {
  data: TableData;
  /** 传了,格子可点、下钻去处你定;不传,宿主里走证据室深链,宿主外纯展示。 */
  attemptHref?: (locator: AttemptLocator) => string;
  /**
   * web 面在表格前渲染一个过滤输入框(`<input class="nre-filter" data-nre-filter>`),
   * 由渐进增强 runtime(enhance.js)接管:输入过滤行 textContent。无 JS 时输入框
   * 静默无功能,表格内容依旧完整可读。默认 false;text 面不受影响。
   */
  filter?: boolean;
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

export interface MetricMatrixProps {
  data: MatrixData;
  attemptHref?: (locator: AttemptLocator) => string;
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

export interface ScoreboardProps {
  data: ScoreboardData;
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

/** MetricScatter 两臂共享的纯渲染选项(不含数据来源)。 */
interface MetricScatterRenderProps {
  /** 点一个点 → 该配置的下钻页。 */
  pointHref?: (row: ScatterData["rows"][number]) => string;
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

/** resolve 之后 web / text 面看到的形态:数据已备好,零 IO。 */
export interface MetricScatterResolvedProps extends MetricScatterRenderProps {
  data: ScatterData;
}

/**
 * 互斥两臂:要么直接给算好的 `data`(用于用户自己的 React 页面 / 预计算 / 跨边界序列化),
 * 要么给 `selection` + 计算选项让宿主在渲染前解析(见 tree.ts 的 resolveReportTree)。
 * 同时传 `data` 与 `selection`、或两者都不传,都在 typecheck 阶段失败。计算选项复用
 * `ScatterDataOptions`,不手写会漂移的副本。
 */
export type MetricScatterProps =
  | (MetricScatterResolvedProps & {
      selection?: never;
      points?: never;
      series?: never;
      x?: never;
      y?: never;
    })
  | ({ data?: never } & ScatterDataOptions & MetricScatterRenderProps & { selection: Selection });

export interface MetricLineProps {
  data: LineData;
  pointHref?: (row: LineData["rows"][number]) => string;
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

export interface DeltaTableProps {
  data: DeltaData;
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

// ───────────────────────── 装配 ─────────────────────────

const SCATTER_UNRESOLVED_MESSAGE =
  "MetricScatter received unresolved (selection-form) props outside the report host pipeline. " +
  "Render through defineReport + niceeval show/view (or renderReportToText/renderReportToStaticHtml), " +
  "or precompute with `await MetricScatter.data(selection, options)` and pass the result as `data`.";

/** 渲染面(web / text)只吃已解析的数据形态;selection 形态漏解析时直说,而不是画一张空组件。 */
function requireScatterData(props: { data?: ScatterData }): ScatterData {
  if (props.data === undefined) throw new Error(SCATTER_UNRESOLVED_MESSAGE);
  return props.data;
}

/** 页头 KPI 条:何时跑的、几个配置、几道题、通过率、总成本;Selection 的警告随行显示在条内。 */
export const RunOverview: ReportComponent<RunOverviewProps> & { data: typeof overviewData } = Object.assign(
  defineComponent<RunOverviewProps>({
    web: (props, ctx) => <RunOverviewWeb {...props} locale={props.locale ?? ctx.locale} />,
    text: ({ data }, ctx) => overviewText(data, ctx),
  }),
  { data: overviewData },
);
RunOverview.displayName = "RunOverview";

/**
 * 组摘要:一组 experiment(典型用法是同一 `<Section>` 内的全部 experiment)的紧凑统计——
 * 通过率(旧 GroupSelector 卡片口径)、experiment/eval/attempt 数、eval 级折叠计票、
 * 总成本、最后运行时间。
 */
export const GroupSummary: ReportComponent<GroupSummaryProps> & { data: typeof groupSummaryData } = Object.assign(
  defineComponent<GroupSummaryProps>({
    web: (props, ctx) => <GroupSummaryWeb {...props} locale={props.locale ?? ctx.locale} />,
    text: ({ data }, ctx) => groupSummaryText(data, ctx),
  }),
  { data: groupSummaryData },
);
GroupSummary.displayName = "GroupSummary";

/**
 * 实验列表:每项一个 experiment,固定展示身份、配置(flags)、Eval 判定构成和官方两级聚合
 * 汇总指标;展开到这个 experiment 的 Eval,每道题内联该题全部 Attempt 的 locator 徽标。
 * 没有 selection-form:`ExperimentList.data(selection)` 产出普通数组,过滤由报告作者对
 * 数组调用 `.filter()`。
 */
export const ExperimentList: ReportComponent<ExperimentListProps> & { data: typeof experimentListData } =
  Object.assign(
    defineComponent<ExperimentListProps>({
      web: (props, ctx) => <ExperimentListWeb {...props} locale={props.locale ?? ctx.locale} attemptHref={ctx.attemptHref} />,
      text: ({ items }, ctx) => experimentListText(items, ctx),
    }),
    { data: experimentListData },
  );
ExperimentList.displayName = "ExperimentList";

/**
 * Eval 列表:每项一个 `experimentId + evalId`,固定展示判定、Attempt 数、分数、成本、耗时
 * 与失败原因;展开到这道题的 Attempt(与 AttemptList 同一份 AttemptListItem)。
 */
export const EvalList: ReportComponent<EvalListProps> & { data: typeof evalListData } = Object.assign(
  defineComponent<EvalListProps>({
    web: (props, ctx) => <EvalListWeb {...props} locale={props.locale ?? ctx.locale} attemptHref={ctx.attemptHref} />,
    text: ({ items }, ctx) => evalListText(items, ctx),
  }),
  { data: evalListData },
);
EvalList.displayName = "EvalList";

/**
 * Attempt 列表:实体列表的叶子层,每项一个 Attempt,固定展示判定、断言、error、Judge 评语
 * (assertions 的 detail/evidence)与证据引用(locator + 证据能力标记)。它不预设只看失败;
 * 报告作者过滤 `AttemptListItem[]`、用 `.slice()` 限量,`total` 让渲染面如实报告剩余数量。
 */
export const AttemptList: ReportComponent<AttemptListProps> & { data: typeof attemptListData } = Object.assign(
  defineComponent<AttemptListProps>({
    web: (props, ctx) => <AttemptListWeb {...props} locale={props.locale ?? ctx.locale} attemptHref={ctx.attemptHref} />,
    text: ({ items, total }, ctx) => attemptListText(items, total, ctx),
  }),
  { data: attemptListData },
);
AttemptList.displayName = "AttemptList";

/** 榜单:一行一个维度值、一列一个指标,回答「谁整体更好」。 */
export const MetricTable: ReportComponent<MetricTableProps> & { data: typeof tableData } = Object.assign(
  defineComponent<MetricTableProps>({
    web: (props, ctx) => (
      <MetricTableWeb
        {...props}
        locale={props.locale ?? ctx.locale}
        attemptHref={props.attemptHref ?? (isHostWebContextActive() ? ctx.attemptHref : undefined)}
      />
    ),
    text: ({ data }, ctx) => tableText(data, ctx),
  }),
  { data: tableData },
);
MetricTable.displayName = "MetricTable";

/** 逐题格子:行 × 列两个维度、格子里一个指标,回答「哪道题谁挂了」。 */
export const MetricMatrix: ReportComponent<MetricMatrixProps> & { data: typeof matrixData } = Object.assign(
  defineComponent<MetricMatrixProps>({
    web: (props, ctx) => (
      <MetricMatrixWeb
        {...props}
        locale={props.locale ?? ctx.locale}
        attemptHref={props.attemptHref ?? (isHostWebContextActive() ? ctx.attemptHref : undefined)}
      />
    ),
    text: ({ data }, ctx) => matrixText(data, ctx),
  }),
  { data: matrixData },
);
MetricMatrix.displayName = "MetricMatrix";

/** 分组条形:同一份矩阵数据的另一种摆法;MetricBars.data 就是 MetricMatrix.data 的别名。 */
export const MetricBars: ReportComponent<MetricMatrixProps> & { data: typeof matrixData } = Object.assign(
  defineComponent<MetricMatrixProps>({
    web: (props, ctx) => (
      <MetricBarsWeb
        {...props}
        locale={props.locale ?? ctx.locale}
        attemptHref={props.attemptHref ?? (isHostWebContextActive() ? ctx.attemptHref : undefined)}
      />
    ),
    text: ({ data }) => barsText(data),
  }),
  { data: matrixData },
);
MetricBars.displayName = "MetricBars";

/** 考试成绩单:总分 + 分科小计,固定分母、missing 如实报。 */
export const Scoreboard: ReportComponent<ScoreboardProps> & { data: typeof scoreboardData } = Object.assign(
  defineComponent<ScoreboardProps>({
    web: (props, ctx) => <ScoreboardWeb {...props} locale={props.locale ?? ctx.locale} />,
    text: ({ data }, ctx) => scoreboardText(data, ctx),
  }),
  { data: scoreboardData },
);
Scoreboard.displayName = "Scoreboard";

/** 质量 × 成本 frontier:每个点一个配置、两个指标各占一轴,「好」的角落恒在右上。 */
export const MetricScatter: ReportComponent<MetricScatterProps> & { data: typeof scatterData } = Object.assign(
  defineComponent<MetricScatterProps, MetricScatterResolvedProps>({
    resolve: async (props) => {
      if ("data" in props && props.data !== undefined) return props;
      const { selection, points, series, x, y, ...rest } = props;
      return { ...rest, data: await scatterData(selection, { points, series, x, y }) };
    },
    web: (props, ctx) => {
      requireScatterData(props);
      return <MetricScatterWeb {...props} locale={props.locale ?? ctx.locale} />;
    },
    text: (props, ctx) => scatterText(requireScatterData(props), ctx),
  }),
  { data: scatterData },
);
MetricScatter.displayName = "MetricScatter";

/** 趋势线:x 是 experiment 声明的 flag(flag()),同系列按 x 排序连线。 */
export const MetricLine: ReportComponent<MetricLineProps> & { data: typeof lineData } = Object.assign(
  defineComponent<MetricLineProps>({
    web: (props, ctx) => <MetricLineWeb {...props} locale={props.locale ?? ctx.locale} />,
    text: ({ data }, ctx) => lineText(data, ctx),
  }),
  { data: lineData },
);
MetricLine.displayName = "MetricLine";

/** 成对对比:每行一对配置、格子里 A、B、Δ 三个值,涨跌好坏由 better 判定。 */
export const DeltaTable: ReportComponent<DeltaTableProps> & { data: typeof deltaData } = Object.assign(
  defineComponent<DeltaTableProps>({
    web: (props, ctx) => <DeltaTableWeb {...props} locale={props.locale ?? ctx.locale} />,
    text: ({ data }, ctx) => deltaText(data, ctx),
  }),
  { data: deltaData },
);
DeltaTable.displayName = "DeltaTable";
