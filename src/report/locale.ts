// 官方组件 chrome 文案的 locale 字典(en / zh-CN 两份)。
// 只覆盖组件自带的固定文案(verdict 词、缺数据、覆盖率角标、注脚、占位符等);
// 数据本身(display、维度键、warnings 的 message)不经这里。
// 刻意不 import src/i18n/(CLI 专用字典,locale 来源与 key 面完全不同);
// zh-CN 译法与 src/view/app/i18n.ts 现有词保持一致(成功率/平均耗时/预估成本…)。

/** 报告渲染的 locale;默认 "en"(text 面缺省即 en,`niceeval show` 输出不变)。 */
export type ReportLocale = "en" | "zh-CN";

export const DEFAULT_REPORT_LOCALE: ReportLocale = "en";

const en = {
  "verdict.passed": "passed",
  "verdict.failed": "failed",
  "verdict.errored": "errored",
  "verdict.skipped": "skipped",

  /** 全 null / 无样本的统一文案,绝不画 0。 */
  "cell.missing": "no data",
  "cell.measuredTitle": "{samples}/{total} attempts measured",
  "cell.noneMeasurableTitle": "0/{total} attempts measurable",
  "cell.coverageTitle": "coverage {samples}/{total}: this metric is null for the remaining attempts",

  "table.higherBetter": "higher is better",
  "table.lowerBetter": "lower is better",
  "table.model": "Model",
  "table.agent": "Agent",
  "table.verdicts": "Verdicts",
  "table.filterPlaceholder": "Filter rows…",
  "table.eval": "Eval",
  "table.reason": "Reason",
  "table.viewBreakdown": "Per-eval breakdown",
  /** <Table> 的 locator 列表头(行带 locator 时自动追加)。 */
  "table.attempt": "attempt",
  "experimentList.experiment": "Experiment",
  "experimentList.avgDuration": "Avg duration",
  "experimentList.passRate": "Pass rate",
  "experimentList.tokens": "Tokens",
  "experimentList.estimatedCost": "Est. cost",
  "experimentList.result": "Result",
  "experimentList.status": "Status",
  "experimentList.evalAttempt": "Eval / Attempt",
  "experimentList.duration": "Duration",
  "experimentList.cost": "Cost",
  "experimentList.filterPlaceholder": "Filter experiments…",
  "experimentList.defaultModel": "default",
  "experimentList.flags": "Flags",
  /** <Table> 压到下限仍放不下时,从右侧丢列并如实报数。 */
  "table.columnsHidden.one": "({n} more column not shown)",
  "table.columnsHidden.other": "({n} more columns not shown)",

  "overview.snapshots": "Snapshots",
  "overview.evals": "Evals",
  "overview.attempts": "attempts",
  "overview.passRate": "Pass rate",
  "overview.totalCost": "Total cost",
  "overview.totalDuration": "Total duration",
  "overview.source": "Source: {n} snapshots",
  "overview.experiments.one": "{n} experiment",
  "overview.experiments.other": "{n} experiments",
  "overview.evalsCount": "{n} evals",
  "overview.attemptsCount": "{n} attempts",

  /** GroupSummary 的 KPI dt 标签(其余字段复用 verdict.* / overview.* 已有 key)。 */
  "groupSummary.experiments": "Experiments",

  "composedFrom.one": "composed from {n} run",
  "composedFrom.other": "composed from {n} runs",
  "latestRun": "latest {run}",

  "scatter.betterHint": "better ↗",
  "scatter.betterUpperRight": "better → upper right",
  "scatter.axisReversed": "(axis reversed: right = better)",
  /** 0 个可画点:x/y 指标没有可用数据。 */
  "scatter.noData": "No data to plot {x} × {y}",
  "pointsMissing.one": "{n} point missing data",
  "pointsMissing.other": "{n} points missing data",

  "attemptList.empty": "No attempts",
  "attemptList.truncated": "and {n} more not shown",
  "attemptList.truncatedText": "({n} more not shown)",
  "attemptList.score": "score {score}",
  "attemptList.unavailable": "unavailable",
  "attemptList.details": "details",

  "scoreboard.total": "Total",
  "scoreboard.totalText": "total",
  "scoreboard.missing.one": "{n} eval missing, scored 0",
  "scoreboard.missing.other": "{n} evals missing, scored 0",
  "scoreboard.missingText": "({n} missing)",
  "scoreboard.weights": "weights:",
  "scoreboard.allWeights": "all evals ×1",
  "scoreboard.othersWeight": "others ×1",
  "scoreboard.subjectTitle": "{evals} evals, weighted {earned} of {possible}",

  "delta.pairHeader": "pair (A → B)",

  "board.currentVerdicts": "Current verdicts",
  "board.failing": "Failing:",
} as const;

export type ReportMessageKey = keyof typeof en;

const zhCN: Record<ReportMessageKey, string> = {
  "verdict.passed": "通过",
  "verdict.failed": "失败",
  "verdict.errored": "错误",
  "verdict.skipped": "跳过",

  "cell.missing": "无数据",
  "cell.measuredTitle": "{samples}/{total} 次 attempt 测得",
  "cell.noneMeasurableTitle": "0/{total} 次 attempt 可测",
  "cell.coverageTitle": "覆盖率 {samples}/{total}:其余 attempt 测不了这个指标",

  "table.higherBetter": "越高越好",
  "table.lowerBetter": "越低越好",
  "table.model": "模型",
  "table.agent": "Agent",
  "table.verdicts": "结果",
  "table.filterPlaceholder": "筛选行…",
  "table.eval": "题目",
  "table.reason": "原因",
  "table.viewBreakdown": "逐题明细",
  "table.attempt": "Attempt",
  "experimentList.experiment": "实验",
  "experimentList.avgDuration": "平均耗时",
  "experimentList.passRate": "成功率",
  "experimentList.tokens": "Tokens",
  "experimentList.estimatedCost": "预估成本",
  "experimentList.result": "结果",
  "experimentList.status": "状态",
  "experimentList.evalAttempt": "题目 / Attempt",
  "experimentList.duration": "耗时",
  "experimentList.cost": "成本",
  "experimentList.filterPlaceholder": "筛选实验…",
  "experimentList.defaultModel": "默认",
  "experimentList.flags": "Flags",
  "table.columnsHidden.one": "(还有 {n} 列未列出)",
  "table.columnsHidden.other": "(还有 {n} 列未列出)",

  "overview.snapshots": "快照",
  "overview.evals": "题目",
  "overview.attempts": "尝试",
  "overview.passRate": "通过率",
  "overview.totalCost": "总成本",
  "overview.totalDuration": "总耗时",
  "overview.source": "数据来源:{n} 个快照",
  "overview.experiments.one": "{n} 个实验",
  "overview.experiments.other": "{n} 个实验",
  "overview.evalsCount": "{n} 道题",
  "overview.attemptsCount": "{n} 次 attempt",

  "groupSummary.experiments": "实验数",

  "composedFrom.one": "合成自 {n} 个 run",
  "composedFrom.other": "合成自 {n} 个 run",
  "latestRun": "最新 {run}",

  "scatter.betterHint": "更好 ↗",
  "scatter.betterUpperRight": "更好 → 右上",
  "scatter.axisReversed": "(轴反向:右 = 更好)",
  "scatter.noData": "{x} × {y} 没有可绘制的数据",
  "pointsMissing.one": "{n} 个点缺数据",
  "pointsMissing.other": "{n} 个点缺数据",

  "attemptList.empty": "没有 attempt",
  "attemptList.truncated": "还有 {n} 条未列出",
  "attemptList.truncatedText": "(还有 {n} 条未列出)",
  "attemptList.score": "得分 {score}",
  "attemptList.unavailable": "评不了",
  "attemptList.details": "详情",

  "scoreboard.total": "总分",
  "scoreboard.totalText": "总分",
  "scoreboard.missing.one": "{n} 道题缺席,按 0 计",
  "scoreboard.missing.other": "{n} 道题缺席,按 0 计",
  "scoreboard.missingText": "(缺 {n} 题)",
  "scoreboard.weights": "权重:",
  "scoreboard.allWeights": "全部题 ×1",
  "scoreboard.othersWeight": "其余 ×1",
  "scoreboard.subjectTitle": "{evals} 道题,加权得分 {earned}/{possible}",

  "delta.pairHeader": "对比 (A → B)",

  "board.currentVerdicts": "现刻判定",
  "board.failing": "失败清单:",
};

const dictionaries: Record<ReportLocale, Record<ReportMessageKey, string>> = {
  en,
  "zh-CN": zhCN,
};

/** 查字典 + 简单插值({name} 占位符)。缺 locale 回退 en。 */
export function localeText(
  locale: ReportLocale,
  key: ReportMessageKey,
  vars?: Record<string, string | number>,
): string {
  const template = dictionaries[locale]?.[key] ?? dictionaries.en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m,
  );
}

/** 带单复数的计数文案:n === 1 用 `<base>.one`,其余 `<base>.other`(zh-CN 两键同值)。 */
export function countText(
  locale: ReportLocale,
  base: "overview.experiments" | "composedFrom" | "pointsMissing" | "scoreboard.missing" | "table.columnsHidden",
  n: number,
): string {
  return localeText(locale, `${base}.${n === 1 ? "one" : "other"}` as ReportMessageKey, { n });
}

/** 指标 label 的可本地化形态:字符串,或按 locale 给的字典(缺项回退 en,再回退任一非空值)。 */
export type LocalizedLabel = string | Partial<Record<ReportLocale, string>>;

/**
 * 按 locale 解析指标 label:字符串原样;字典取当前 locale,缺项回退 en,
 * 再回退字典里任一值;全空回退 fallback(= metric.name)。渲染面(web / text)共用。
 */
export function resolveMetricLabel(
  label: LocalizedLabel | undefined,
  locale: ReportLocale,
  fallback: string,
): string {
  if (label === undefined) return fallback;
  if (typeof label === "string") return label;
  return label[locale] ?? label.en ?? Object.values(label).find((v) => v !== undefined) ?? fallback;
}
