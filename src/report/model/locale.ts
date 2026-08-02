// 官方组件 chrome 文案的 locale 字典与 LocalizedText 解析。
// ReportLocale 是开放的 BCP 47 标签(数据协议不封语言上限);官方内置文案与
// 内部旧切片的 LocalizedText 生成面覆盖 en / zh-CN；公共 MetricValue 由 renderer
// 按当前 locale 格式化。
// 只覆盖组件自带的固定文案(verdict 词、缺数据、覆盖率角标、注脚、占位符等);
// 维度键、issues 的 message 不经这里。
// 刻意不 import src/i18n/(CLI 专用字典,locale 来源与 key 面完全不同)。

import type { LocalizedText } from "../../types.ts";

export type { LocalizedText };

/** 报告渲染的 locale(BCP 47 标签,开放);默认 "en"(`niceeval show` 缺省输出不变)。 */
export type ReportLocale = string;

export const DEFAULT_REPORT_LOCALE: ReportLocale = "en";

/** 内部旧切片 LocalizedText 生成面覆盖的 locale 全集。 */
export const DISPLAY_LOCALES: readonly ReportLocale[] = ["en", "zh-CN"];

/**
 * LocalizedText 的确定回退:取当前 locale;缺失时取 en;仍缺失时取按 locale 键字典序的
 * 第一个非空值。对象没有任何非空值时报错,不渲染空文案
 * (docs/feature/reports/library/shell.md「行为约束」)。
 */
export function resolveLocalizedText(text: LocalizedText, locale: ReportLocale): string {
  if (typeof text === "string") return text;
  const direct = text[locale];
  if (direct !== undefined && direct !== "") return direct;
  const en = text.en;
  if (en !== undefined && en !== "") return en;
  for (const key of Object.keys(text).sort()) {
    const value = text[key];
    if (value !== undefined && value !== "") return value;
  }
  throw new Error(
    "LocalizedText object has no non-empty value. Provide at least one locale entry, e.g. { en: \"…\" }.",
  );
}

/** LocalizedText 按字段值深相等(键顺序无关;标题回退链的「唯一且相同」判定用)。 */
export function localizedTextEquals(a: LocalizedText, b: LocalizedText): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key, i) => key === keysB[i] && a[key] === b[key]);
}

const en = {
  "verdict.passed": "passed",
  "verdict.failed": "failed",
  "verdict.errored": "errored",
  "verdict.skipped": "skipped",

  /** AttemptSummary 的重试序号(0 起的 identity.attempt 显示前 +1)。 */
  "attemptSummary.attempt": "attempt {n}",

  /** 全 null / 无样本的统一文案,绝不画 0。 */
  "cell.missing": "no data",
  /** missing 格 code=`notRun`:固定题集里这道题没有 attempt。 */
  "cell.notRun": "not run",
  /** missing 格 code=`unscorable`:有 attempt,但读数测不出。 */
  "cell.unscorable": "unscorable",
  "cell.measuredTitle": "{samples}/{total} attempts measured",
  "cell.noneMeasurableTitle": "0/{total} attempts measurable",
  "cell.coverageTitle": "coverage {samples}/{total}: this metric is null for the remaining attempts",
  "cell.missingValue": "(missing)",
  "cell.evidence.one": "{n} attempt",
  "cell.evidence.other": "{n} attempts",

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
  "experimentList.avgDuration": "Avg. time",
  "experimentList.passRate": "Pass rate",
  "experimentList.passRateDescription": "End-to-end pass rate: passed = 1; failed and errored = 0",
  "experimentList.totalScore": "Total score",
  "experimentList.totalScoreDescription": "Total score: sum of points earned across evals",
  "experimentList.tokens": "Tokens",
  "experimentList.cost": "Cost",
  "experimentList.result": "Record",
  "experimentList.status": "Status",
  "experimentList.evalAttempt": "Eval / Attempt",
  "experimentList.duration": "Duration",
  "experimentList.filterPlaceholder": "Filter experiments…",
  "experimentList.defaultModel": "default",
  "experimentList.flags": "Flags",
  "entityList.average": "{value} avg",
  "entityList.moreFailures.one": "+{n} more failure",
  "entityList.moreFailures.other": "+{n} more failures",
  /** 计分制 passed attempt 丢分得分点的「其余」计数(规则 6);与 moreFailures 同结构,措辞不同——
   *  丢分不是失败,不该说成 "more failures"(entity-lists.md AttemptListItem.moreFailures 字段注释)。 */
  "entityList.moreLostPoints.one": "+{n} more lost point",
  "entityList.moreLostPoints.other": "+{n} more lost points",
  /** <Table> 压到下限仍放不下时,从右侧丢列并如实报数。 */
  "table.columnsHidden.one": "({n} more column not shown)",
  "table.columnsHidden.other": "({n} more columns not shown)",

  /** StabilityOverview 的读数格标签。 */
  "stabilityOverview.executions": "Executions",
  "stabilityOverview.neverPassed": "Never passed",
  "stabilityOverview.flaky": "Flaky evals",

  /** ScopeSummary 的 KPI 标签。 */
  "scopeSummary.experiments": "Experiments",
  "scopeSummary.evals": "Evals",
  "scopeSummary.attempts": "Attempts",
  "scopeSummary.passRate": "Pass rate",
  "scopeSummary.totalScore": "Total score",
  "scopeSummary.totalCost": "Total cost",
  "scopeSummary.lastRun": "Last run · {time}",
  "scopeSummary.runRange": "Run range · {from} – {to}",
  "scopeSummary.costCoverage": "Cost available for {samples}/{total} attempts",
  "scopeSummary.votesEval": "Eval results",
  "scopeSummary.votesAttempt": "Attempt results",
  "overview.experiments.one": "{n} experiment",
  "overview.experiments.other": "{n} experiments",
  "overview.evalsCount": "{n} evals",
  "overview.attemptsCount": "{n} attempts",
  "overview.evals": "Evals",
  "overview.passRate": "Pass rate",
  "overview.totalCost": "Cost",

  /** 方向提示唯一文案:轴向已随 better 反正,「更好」恒指向右上(两轴都声明 better 时才显示)。 */
  "scatter.betterUpperRight": "better → upper right",
  /** 读值表的系列列表头;多个系列同图时才出现。 */
  "chart.series": "series",
  /** 0 个可画点:x/y 指标没有可用数据。 */
  "scatter.noData": "No data to plot {x} × {y}",
  /** 标题行尾的归类维度标注(series 维度存在时显示)。 */
  "scatter.groupedBy": "grouped by {dim}",
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
  "scoreboard.notRun.one": "{n} eval not run, scored 0",
  "scoreboard.notRun.other": "{n} evals not run, scored 0",
  "scoreboard.unscorable.one": "{n} eval unscorable, scored 0",
  "scoreboard.unscorable.other": "{n} evals unscorable, scored 0",
  "scoreboard.notRunText": "({n} not run)",
  "scoreboard.unscorableText": "({n} unscorable)",
  "scoreboard.ignored.one": "{n} eval outside the question set ignored",
  "scoreboard.ignored.other": "{n} evals outside the question set ignored",
  "scoreboard.weights": "weights:",
  "scoreboard.allWeights": "all evals ×1",
  "scoreboard.othersWeight": "others ×1",
  "scoreboard.subjectTitle": "{questions} evals, weighted {earned} of {possible}",

  "delta.empty": "{experiments} experiments, 0 comparable conditions",
  "delta.totalsRow": "totals",
  "delta.passRate": "pass rate",
  "delta.totalScore": "total score",
  "delta.cost": "cost",
  "delta.commonVsBaseline": "{n} common vs baseline",

  "stability.neverPassed": "never passed",

  /** ScopeWarnings 聚合层的 chrome:汇总行、kind 徽标、组头与明细折叠标签;message 本体不经字典。 */
  "issues.summary.experiments.one": "{n} experiment flagged",
  "issues.summary.experiments.other": "{n} experiments flagged",
  "issues.group.unreadableSnapshot.one": "{n} run skipped",
  "issues.group.unreadableSnapshot.other": "{n} runs skipped",
  "issues.details.one": "{n} warning",
  "issues.details.other": "{n} issues",
  "issues.badge.unfinishedSnapshot": "unfinished",

  /** 覆盖缺口(scope.coverage)与时效标注(见 entity-lists.md「时效标注」「ExperimentList」)。 */
  "overview.evalsCountPartial": "{covered}/{total} evals",
  "experimentList.historicalAttempts": "↩ {n}/{m} attempts",
  "experimentList.noResultsForConfig": "no results under the current configuration",

  /** Hero / HeroCard 的运行 meta(hero.noRuns 是 latestStartedAt 为 null 时的内置文案)。 */
  "hero.lastRun": "Last run {time}",
  "hero.noRuns": "No runs yet",
  /** web 面的合成来源标注(仅 runs > 1 时显示)。 */
  "hero.composedRuns": "composed from {n} runs",
  /** text 面的合成来源标注(show 页首 meta 行,仅 runs > 1 时显示)。 */
  "hero.composedSnapshots": "composed from {n} runs",

  /** CopyFixPrompt 的 web 面 chrome(prompt 本身面向 agent、固定英文,不经词典)。 */
  "copyFixPrompt.summary.one": "Fix prompt · {n} failure",
  "copyFixPrompt.summary.other": "Fix prompt · {n} failures",
  "copyFixPrompt.copy": "Copy fix prompt",

  /** TraceWaterfall 的 chrome。 */
  "traceWaterfall.empty": "No attempts",
  "traceWaterfall.noTrace": "no trace",
  "traceWaterfall.spans.one": "{n} span",
  "traceWaterfall.spans.other": "{n} spans",
  "traceWaterfall.failedSpans.one": "{n} failed",
  "traceWaterfall.failedSpans.other": "{n} failed",

  /** Waterfall 原语的 chrome。 */
  "waterfall.nodes.one": "{n} node",
  "waterfall.nodes.other": "{n} nodes",
  "waterfall.failedNodes.one": "{n} failed",
  "waterfall.failedNodes.other": "{n} failed",
  "waterfall.foldTotal": "{t} total",

  /** SnapshotDiagnostics 聚合层的 chrome:汇总行三段计数与最高严重度;message/command 本体不经字典。 */
  "snapshotDiagnostics.summary.experiments.one": "{n} experiment",
  "snapshotDiagnostics.summary.experiments.other": "{n} experiments",
  "snapshotDiagnostics.summary.runs.one": "{n} run",
  "snapshotDiagnostics.summary.runs.other": "{n} runs",
  "snapshotDiagnostics.summary.records.one": "{n} record",
  "snapshotDiagnostics.summary.records.other": "{n} records",
  "snapshotDiagnostics.severity.warning": "issues only",
  "snapshotDiagnostics.severity.error": "errors present",

  /** AttemptList 的 web 面过滤框占位符(filter 渐进增强)。 */
  "attemptList.filterPlaceholder": "Filter attempts…",

  /** 计分制 attempt 详情的 chrome(docs/feature/assertions/library/display.md「计分制」)。 */
  "attemptAssertions.scorePointsEarned": "{earned}/{total} score points earned in full",
  "attemptAssertions.scoreEntries": "Score entries",
  /** 断言表的四列表头。 */
  "attemptAssertions.name": "Assertion",
  "attemptAssertions.severity": "Severity",
  "attemptAssertions.outcome": "Outcome",
  "attemptAssertions.detail": "Detail",
  "attemptSource.abortReason": "prerequisite failed, test() ended here",

  "tabs.tab": "Tab",
} as const;

export type ReportMessageKey = keyof typeof en;

const zhCN: globalThis.Record<ReportMessageKey, string> = {
  "verdict.passed": "通过",
  "verdict.failed": "失败",
  "verdict.errored": "错误",
  "verdict.skipped": "跳过",

  "attemptSummary.attempt": "第 {n} 次",

  "cell.missing": "无数据",
  "cell.notRun": "未跑到",
  "cell.unscorable": "测不出",
  "cell.measuredTitle": "{samples}/{total} 次 attempt 测得",
  "cell.noneMeasurableTitle": "0/{total} 次 attempt 可测",
  "cell.coverageTitle": "覆盖率 {samples}/{total}:其余 attempt 测不了这个指标",
  "cell.missingValue": "(missing)",
  "cell.evidence.one": "{n} 个 Attempt",
  "cell.evidence.other": "{n} 个 Attempt",

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
  "experimentList.passRate": "通过率",
  "experimentList.passRateDescription": "端到端通过率：passed = 1；failed 和 errored = 0",
  "experimentList.totalScore": "总分",
  "experimentList.totalScoreDescription": "总分：各 Eval 挣分之和",
  "experimentList.tokens": "Tokens",
  "experimentList.cost": "成本",
  "experimentList.result": "结果",
  "experimentList.status": "状态",
  "experimentList.evalAttempt": "题目 / Attempt",
  "experimentList.duration": "耗时",
  "experimentList.filterPlaceholder": "筛选实验…",
  "experimentList.defaultModel": "默认",
  "experimentList.flags": "Flags",
  "entityList.average": "平均 {value}",
  "entityList.moreFailures.one": "+{n} 条其它失败",
  "entityList.moreFailures.other": "+{n} 条其它失败",
  "entityList.moreLostPoints.one": "+{n} 处其它丢分",
  "entityList.moreLostPoints.other": "+{n} 处其它丢分",
  "table.columnsHidden.one": "(还有 {n} 列未列出)",
  "table.columnsHidden.other": "(还有 {n} 列未列出)",

  "stabilityOverview.executions": "历史执行",
  "stabilityOverview.neverPassed": "零通过题",
  "stabilityOverview.flaky": "闪烁题",

  "scopeSummary.experiments": "实验",
  "scopeSummary.evals": "Eval",
  "scopeSummary.attempts": "Attempt",
  "scopeSummary.passRate": "通过率",
  "scopeSummary.totalScore": "总分",
  "scopeSummary.totalCost": "总成本",
  "scopeSummary.lastRun": "最近运行 · {time}",
  "scopeSummary.runRange": "运行范围 · {from} – {to}",
  "scopeSummary.costCoverage": "{samples}/{total} 次有成本数据",
  "scopeSummary.votesEval": "Eval 结果",
  "scopeSummary.votesAttempt": "Attempt 结果",
  "overview.experiments.one": "{n} 个实验",
  "overview.experiments.other": "{n} 个实验",
  "overview.evalsCount": "{n} 个 Eval",
  "overview.attemptsCount": "{n} 次 attempt",
  "overview.evals": "Eval",
  "overview.passRate": "通过率",
  "overview.totalCost": "成本",

  "scatter.betterUpperRight": "越靠右上越好",
  "chart.series": "系列",
  "scatter.noData": "{x} × {y} 没有可绘制的数据",
  "scatter.groupedBy": "按 {dim} 归类",
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
  "scoreboard.notRun.one": "{n} 道题没跑,按 0 计",
  "scoreboard.notRun.other": "{n} 道题没跑,按 0 计",
  "scoreboard.unscorable.one": "{n} 道题测不了,按 0 计",
  "scoreboard.unscorable.other": "{n} 道题测不了,按 0 计",
  "scoreboard.notRunText": "(没跑 {n} 题)",
  "scoreboard.unscorableText": "(测不了 {n} 题)",
  "scoreboard.ignored.one": "题集之外的 {n} 道题已忽略",
  "scoreboard.ignored.other": "题集之外的 {n} 道题已忽略",
  "scoreboard.weights": "权重:",
  "scoreboard.allWeights": "全部题 ×1",
  "scoreboard.othersWeight": "其余 ×1",
  "scoreboard.subjectTitle": "{questions} 道题,加权得分 {earned}/{possible}",

  "delta.empty": "{experiments} 个实验、0 个可配对条件",
  "delta.totalsRow": "汇总",
  "delta.passRate": "通过率",
  "delta.totalScore": "总分",
  "delta.cost": "成本",
  "delta.commonVsBaseline": "共同 {n} 题对基准",

  "stability.neverPassed": "从未通过",

  "issues.summary.experiments.one": "{n} 个实验的数字带警告",
  "issues.summary.experiments.other": "{n} 个实验的数字带警告",
  "issues.group.unreadableSnapshot.one": "{n} 个快照被跳过",
  "issues.group.unreadableSnapshot.other": "{n} 个快照被跳过",
  "issues.details.one": "{n} 条原始警告",
  "issues.details.other": "{n} 条原始警告",
  "issues.badge.unfinishedSnapshot": "未收尾",

  "overview.evalsCountPartial": "{covered}/{total} 个 Eval",
  "experimentList.historicalAttempts": "↩ {n}/{m} attempts",
  "experimentList.noResultsForConfig": "当前配置下无结果",

  "hero.lastRun": "最后运行 {time}",
  "hero.noRuns": "暂无运行",
  "hero.composedRuns": "由 {n} 次运行合成",
  "hero.composedSnapshots": "由 {n} 份快照合成",

  "copyFixPrompt.summary.one": "修复 prompt · {n} 个失败",
  "copyFixPrompt.summary.other": "修复 prompt · {n} 个失败",
  "copyFixPrompt.copy": "复制修复 prompt",

  "traceWaterfall.empty": "没有 attempt",
  "traceWaterfall.noTrace": "无 trace",
  "traceWaterfall.spans.one": "{n} 个 span",
  "traceWaterfall.spans.other": "{n} 个 span",
  "traceWaterfall.failedSpans.one": "{n} 个失败",
  "traceWaterfall.failedSpans.other": "{n} 个失败",

  "waterfall.nodes.one": "{n} 个节点",
  "waterfall.nodes.other": "{n} 个节点",
  "waterfall.failedNodes.one": "{n} 个失败",
  "waterfall.failedNodes.other": "{n} 个失败",
  "waterfall.foldTotal": "合计 {t}",

  "snapshotDiagnostics.summary.experiments.one": "{n} 个实验",
  "snapshotDiagnostics.summary.experiments.other": "{n} 个实验",
  "snapshotDiagnostics.summary.runs.one": "{n} 个快照",
  "snapshotDiagnostics.summary.runs.other": "{n} 个快照",
  "snapshotDiagnostics.summary.records.one": "{n} 条记录",
  "snapshotDiagnostics.summary.records.other": "{n} 条记录",
  "snapshotDiagnostics.severity.warning": "仅警告",
  "snapshotDiagnostics.severity.error": "含错误",

  "attemptList.filterPlaceholder": "筛选 attempt…",

  "attemptAssertions.scorePointsEarned": "{earned}/{total} 得分点挣满",
  "attemptAssertions.scoreEntries": "给分记录",
  "attemptAssertions.name": "断言",
  "attemptAssertions.severity": "严重度",
  "attemptAssertions.outcome": "结果",
  "attemptAssertions.detail": "详情",
  "attemptSource.abortReason": "前置未过,test() 就地结束",

  "tabs.tab": "Tab",
};

const dictionaries: globalThis.Record<string, globalThis.Record<ReportMessageKey, string>> = {
  en,
  "zh-CN": zhCN,
};

/** 查字典 + 简单插值({name} 占位符)。内置词典未覆盖的 locale 回退 en。 */
export function localeText(
  locale: ReportLocale,
  key: ReportMessageKey,
  vars?: globalThis.Record<string, string | number>,
): string {
  const template = dictionaries[locale]?.[key] ?? dictionaries.en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m,
  );
}

/**
 * 内置消息键 → 覆盖 `DISPLAY_LOCALES` 的 `LocalizedText`。
 * 列声明的 `header` 这类「值本身要随身携带两种语言」的字段用它烤一份,
 * 渲染面再按当前 locale 解析(docs/feature/reports/components/primitives/table.md)。
 */
export function localizedMessage(key: ReportMessageKey): LocalizedText {
  const text: globalThis.Record<string, string> = {};
  for (const locale of DISPLAY_LOCALES) text[locale] = localeText(locale, key);
  return text;
}

/** 带单复数的计数文案:n === 1 用 `<base>.one`,其余 `<base>.other`(zh-CN 两键同值)。 */
export function countText(
  locale: ReportLocale,
  base:
    | "overview.experiments"
    | "pointsMissing"
    | "scoreboard.notRun"
    | "scoreboard.unscorable"
    | "scoreboard.ignored"
    | "entityList.moreFailures"
    | "entityList.moreLostPoints"
    | "cell.evidence"
    | "table.columnsHidden"
    | "copyFixPrompt.summary"
    | "traceWaterfall.spans"
    | "traceWaterfall.failedSpans"
    | "waterfall.nodes"
    | "waterfall.failedNodes",
  n: number,
): string {
  return localeText(locale, `${base}.${n === 1 ? "one" : "other"}` as ReportMessageKey, { n });
}

/**
 * 按 locale 解析读数 / 列 label;undefined 回退 fallback(= metric.name)。渲染面(web / text)共用。
 */
export function resolveMetricLabel(
  label: LocalizedText | undefined,
  locale: ReportLocale,
  fallback: string,
): string {
  if (label === undefined) return fallback;
  try {
    return resolveLocalizedText(label, locale);
  } catch {
    return fallback;
  }
}
