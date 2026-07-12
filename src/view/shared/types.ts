// server(data.ts)与前端(app/)共用的 view 数据形状。
// viewData 会被序列化进静态 HTML,两边必须对同一份声明编程;只允许 type import。
//
// viewData 只携带证据室与壳需要的东西:快照明细(locator / artifactBase 已注入)、
// skipped、项目名与 run 元信息。统计口径(KPI / 榜单 / 挑选警告)整体住在报告槽的
// 静态 HTML 里(CostPassRateComparison 或 --report 的报告自己算),壳与报告之间没有第二条数据通道。

import type { EvalResult, LocalizedText } from "../../types.ts";
import type { ReportLocale } from "../../report/locale.ts";
import type { AttemptLocator } from "../../results/locator.ts";

export type { AttemptLocator };

/**
 * 报告槽的双语静态 HTML:同一棵报告树按 locale 渲染两遍(en / zh-CN),server 烘成
 * 两个 <template> 静态块,前端按当前界面语言摆放对应块,切语言不重算数据。
 */
export type ReportSlotHtml = Record<ReportLocale, string>;

/** view 侧的 attempt 结果 = 瘦身后的 EvalResult + loader 注入的深链身份(不透明 AttemptLocator,
 * `#/attempt/@<locator>` 路由的参数,与 Reports 的 MetricCell.refs / `ctx.attemptHref` 同一身份契约)
 * 与 artifact 基址。 */
export type ViewEvalResult = EvalResult & { locator?: AttemptLocator };

/**
 * 快照 = 单次跑的实验(experiment × 一次运行),与 niceeval/results 的 Snapshot 同口径。
 * 携带 attempt 明细供证据室(钻取 / AttemptModal / Runs / Traces)渲染;
 * 榜单统计不从这里算,吃 ViewData.table / overview 的官方产物。
 */
export interface ViewSnapshot {
  experimentId: string;
  agent: string;
  model?: string;
  startedAt: string;
  /** 快照的根相对路径(= niceeval/results 的 AttemptRef.snapshot,两段:`<experiment-dir>/<snapshot-dir>`)。 */
  run: string;
  /** 是否为该实验在 results.latest() 口径下的最新一次快照 —— 证据室的 latest 标记,与报告槽 Selection
   (现刻水位,可能合成自更早快照)是两个独立概念,不要混用。 */
  latest: boolean;
  /** 该快照的 attempt 明细(跨快照去重后的幸存条目;locator / artifactBase 已注入)。 */
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
 * 烘焙进 HTML 的页面数据(证据室与壳)。时间/成本一律传原始值(ISO 字符串、number),
 * 格式化统一由前端按当前界面 locale 做。
 */
export interface ViewData {
  /** 项目名(来自 config.name);hero 标题,可按 locale 多语言。 */
  name?: LocalizedText;
  /** 最近一次 run 的 startedAt(ISO);没有历史 run 时缺省。 */
  lastRunAt?: string;
  /** 报告槽 Selection 合成自几个物理 run;hero「合成来源」标注。 */
  composedRuns: number;
  /** 全部历史快照(跨快照按身份键去重后);修复 prompt 吃 latest,Runs / Traces 吃全部。 */
  snapshots: ViewSnapshot[];
  /** 读不了的落盘(三种原因);前端顶部横幅展示,不静默。 */
  skippedRuns?: SkippedRunNotice[];
}
