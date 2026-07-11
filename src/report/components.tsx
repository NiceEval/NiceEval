// 官方双面组件的装配点:web 面(./react/ 的纯 React 组件)+ text 面(./text/faces.ts)
// + 挂在组件上的 data 计算函数。faces 两键必填 —— 配对是结构义务,不是配对表;
// MetricBars.data 就是 MetricMatrix.data(同一份矩阵数据的另一种摆法),别名显式化。
//
// 官方组件在宿主里自动接上证据室:web 面的 attemptHref 缺省取 ctx.attemptHref
// (宿主注入的证据室深链);显式传 prop 可覆盖(嵌进自己应用时自定去处)。

import { defineComponent, isHostWebContextActive } from "./tree.ts";
import type { AttemptRef } from "../results/index.ts";
import type {
  CaseListData,
  DeltaData,
  LineData,
  MatrixData,
  OverviewData,
  ScatterData,
  ScoreboardData,
  TableData,
} from "./types.ts";
import {
  caseListData,
  deltaData,
  lineData,
  matrixData,
  overviewData,
  scatterData,
  scoreboardData,
  tableData,
} from "./compute.ts";
import {
  barsText,
  caseListText,
  deltaText,
  lineText,
  matrixText,
  overviewText,
  scatterText,
  scoreboardText,
  tableText,
} from "./text/faces.ts";
import { RunOverview as RunOverviewWeb } from "./react/RunOverview.tsx";
import { MetricTable as MetricTableWeb } from "./react/MetricTable.tsx";
import { MetricMatrix as MetricMatrixWeb } from "./react/MetricMatrix.tsx";
import { MetricBars as MetricBarsWeb } from "./react/MetricBars.tsx";
import { Scoreboard as ScoreboardWeb } from "./react/Scoreboard.tsx";
import { MetricScatter as MetricScatterWeb } from "./react/MetricScatter.tsx";
import { MetricLine as MetricLineWeb } from "./react/MetricLine.tsx";
import { DeltaTable as DeltaTableWeb } from "./react/DeltaTable.tsx";
import { CaseList as CaseListWeb } from "./react/CaseList.tsx";

// ───────────────────────── props ─────────────────────────

export interface RunOverviewProps {
  data: OverviewData;
  className?: string;
}

export interface MetricTableProps {
  data: TableData;
  /** 传了,格子可点、下钻去处你定;不传,宿主里走证据室深链,宿主外纯展示。 */
  attemptHref?: (ref: AttemptRef) => string;
  className?: string;
}

export interface MetricMatrixProps {
  data: MatrixData;
  attemptHref?: (ref: AttemptRef) => string;
  className?: string;
}

export interface ScoreboardProps {
  data: ScoreboardData;
  className?: string;
}

export interface MetricScatterProps {
  data: ScatterData;
  /** 点一个点 → 该配置的下钻页。 */
  pointHref?: (row: ScatterData["rows"][number]) => string;
  className?: string;
}

export interface MetricLineProps {
  data: LineData;
  pointHref?: (row: LineData["rows"][number]) => string;
  className?: string;
}

export interface DeltaTableProps {
  data: DeltaData;
  className?: string;
}

export interface CaseListProps {
  data: CaseListData;
  attemptHref?: (ref: AttemptRef) => string;
  className?: string;
}

// ───────────────────────── 装配 ─────────────────────────

/** 页头 KPI 条:何时跑的、几个配置、几道题、通过率、总成本;Selection 的警告随行显示在条内。 */
export const RunOverview = Object.assign(
  defineComponent<RunOverviewProps>({
    web: (props) => <RunOverviewWeb {...props} />,
    text: ({ data }) => overviewText(data),
  }),
  { data: overviewData },
);
RunOverview.displayName = "RunOverview";

/** 榜单:一行一个维度值、一列一个指标,回答「谁整体更好」。 */
export const MetricTable = Object.assign(
  defineComponent<MetricTableProps>({
    web: (props, ctx) => <MetricTableWeb {...props} attemptHref={props.attemptHref ?? (isHostWebContextActive() ? ctx.attemptHref : undefined)} />,
    text: ({ data }) => tableText(data),
  }),
  { data: tableData },
);
MetricTable.displayName = "MetricTable";

/** 逐题格子:行 × 列两个维度、格子里一个指标,回答「哪道题谁挂了」。 */
export const MetricMatrix = Object.assign(
  defineComponent<MetricMatrixProps>({
    web: (props, ctx) => <MetricMatrixWeb {...props} attemptHref={props.attemptHref ?? (isHostWebContextActive() ? ctx.attemptHref : undefined)} />,
    text: ({ data }) => matrixText(data),
  }),
  { data: matrixData },
);
MetricMatrix.displayName = "MetricMatrix";

/** 分组条形:同一份矩阵数据的另一种摆法;MetricBars.data 就是 MetricMatrix.data 的别名。 */
export const MetricBars = Object.assign(
  defineComponent<MetricMatrixProps>({
    web: (props, ctx) => <MetricBarsWeb {...props} attemptHref={props.attemptHref ?? (isHostWebContextActive() ? ctx.attemptHref : undefined)} />,
    text: ({ data }) => barsText(data),
  }),
  { data: matrixData },
);
MetricBars.displayName = "MetricBars";

/** 考试成绩单:总分 + 分科小计,固定分母、missing 如实报。 */
export const Scoreboard = Object.assign(
  defineComponent<ScoreboardProps>({
    web: (props) => <ScoreboardWeb {...props} />,
    text: ({ data }) => scoreboardText(data),
  }),
  { data: scoreboardData },
);
Scoreboard.displayName = "Scoreboard";

/** 质量 × 成本 frontier:每个点一个配置、两个指标各占一轴,「好」的角落恒在右上。 */
export const MetricScatter = Object.assign(
  defineComponent<MetricScatterProps>({
    web: (props) => <MetricScatterWeb {...props} />,
    text: ({ data }, ctx) => scatterText(data, ctx),
  }),
  { data: scatterData },
);
MetricScatter.displayName = "MetricScatter";

/** 趋势线:x 是 experiment 声明的 flag(flag()),同系列按 x 排序连线。 */
export const MetricLine = Object.assign(
  defineComponent<MetricLineProps>({
    web: (props) => <MetricLineWeb {...props} />,
    text: ({ data }, ctx) => lineText(data, ctx),
  }),
  { data: lineData },
);
MetricLine.displayName = "MetricLine";

/** 成对对比:每行一对配置、格子里 A、B、Δ 三个值,涨跌好坏由 better 判定。 */
export const DeltaTable = Object.assign(
  defineComponent<DeltaTableProps>({
    web: (props) => <DeltaTableWeb {...props} />,
    text: ({ data }) => deltaText(data),
  }),
  { data: deltaData },
);
DeltaTable.displayName = "DeltaTable";

/** 失败案例清单:榜单回答「多少」,它回答「为什么」;truncated 如实报剩余。 */
export const CaseList = Object.assign(
  defineComponent<CaseListProps>({
    web: (props, ctx) => <CaseListWeb {...props} attemptHref={props.attemptHref ?? (isHostWebContextActive() ? ctx.attemptHref : undefined)} />,
    text: (props, ctx) => caseListText(props.data, ctx),
  }),
  { data: caseListData },
);
CaseList.displayName = "CaseList";
