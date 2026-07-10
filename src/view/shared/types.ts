// server(data.ts)与前端(app/)共用的 view 数据形状。
// viewData 会被序列化进静态 HTML,两边必须对同一份声明编程;只允许 type import。
//
// 统计层收编后(docs/view.md「用 Reports 积木重建 view」迁移顺序 2),烘进 HTML 的不再是
// 私有 rows,而是官方数据契约:OverviewData / TableData(niceeval/report 的计算函数产物)
// + 快照元信息(证据室数据)+ skipped / warnings。前端只做渲染与展示态交互,不再聚合。

import type { EvalResult, LocalizedText } from "../../types.ts";
import type { OverviewData, TableData } from "../../report/types.ts";

// 官方契约的类型再导出(全部 type-only,前端打包时被擦除)。
export type { MetricCell, MetricColumn, OverviewData, SelectionWarning, TableData } from "../../report/types.ts";

/**
 * attempt 的深链身份:run 目录名 + 该 attempt 在 summary.results 里的下标。
 * `#/attempt/<run>/<result>` 路由的参数——与 niceeval/results 的 AttemptRef、Reports 的
 * MetricCell.refs 同一身份契约,报告页(前门)与 view(证据室)靠它指向同一个 attempt。
 */
export interface AttemptRef {
  run: string;
  result: number;
}

/** view 侧的 attempt 结果 = 瘦身后的 EvalResult + loader 注入的深链身份与工件基址。 */
export type ViewEvalResult = EvalResult & { attemptRef?: AttemptRef };

/**
 * 快照 = 单次跑的实验(experiment × run 切片),与 niceeval/results 的 Snapshot 同口径。
 * 携带 attempt 明细供证据室(钻取 / AttemptModal / Runs / Traces)渲染;
 * 榜单统计不从这里算,吃 ViewData.table / overview 的官方产物。
 */
export interface ViewSnapshot {
  /** 落盘缺 experimentId 时是 "<agent>/<model>" 合成键(synthetic: true 同源)。 */
  experimentId: string;
  synthetic?: boolean;
  agent: string;
  model?: string;
  startedAt: string;
  /** 物理 run 目录名(= AttemptRef.run)。 */
  run: string;
  /** 是否该实验最新一次快照 —— 榜单(results.latest() 口径)的成员。 */
  latest: boolean;
  /** 该快照的 attempt 明细(跨快照去重后的幸存条目;attemptRef / artifactBase 已注入)。 */
  results: ViewEvalResult[];
}

/** 目录扫描里被跳过的 run 在页面顶部的提示条目;三种原因与 niceeval/results 的 skipped 一致。 */
export interface SkippedRunNotice {
  /** run 目录,相对 cwd。 */
  dir: string;
  reason: "incompatible-version" | "malformed" | "incomplete";
  schemaVersion?: number;
  /** 完整 producer:只有 name === "niceeval" 才配得出 npx 命令,第三方 harness 如实报名字。 */
  producerName?: string;
  producerVersion?: string;
  /** incompatible-version 且 producer 是 niceeval:服务端拼好的查看命令。 */
  command?: string;
  /** malformed:一句诊断(invalid JSON / results 不是数组 …)。 */
  detail?: string;
}

/**
 * 烘焙进 HTML 的页面数据。时间/比率/成本一律传原始值(ISO 字符串、number),
 * 格式化统一由前端按当前界面 locale 做;官方 MetricCell 自带 display,前端直接渲染。
 */
export interface ViewData {
  /** 项目名(来自 config.name);hero 标题,可按 locale 多语言。 */
  name?: LocalizedText;
  /** 最近一次 run 的 startedAt(ISO);没有历史 run 时缺省。 */
  lastRunAt?: string;
  /** 榜单合成自几个物理 run(latest 选集覆盖的 run 数);表头「合成来源」标注。 */
  composedRuns: number;
  /** 官方 KPI(RunOverview.data 产物):totals + 选中快照元信息 + 选集 warnings 随行。 */
  overview: OverviewData;
  /** 默认报告(MetricTable.data,rows: "experiment"):每个实验最新一次快照的口径。 */
  table: TableData;
  /** 整体单行(MetricTable.data,常量维度):hero 的官方通过率,同一台聚合引擎。 */
  overall: TableData;
  /** 全部历史快照(跨快照按身份键去重后);Experiments 钻取吃 latest,Runs / Traces 吃全部。 */
  snapshots: ViewSnapshot[];
  /** 读不了的落盘(三种原因);前端顶部横幅展示,不静默。 */
  skippedRuns?: SkippedRunNotice[];
}
