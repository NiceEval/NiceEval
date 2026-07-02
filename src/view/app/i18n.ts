import type { Locale } from "./types.ts";

export type MessageKey =
  | "app.title"
  | "nav.label"
  | "nav.experiments"
  | "nav.runs"
  | "nav.traces"
  | "hero.title"
  | "hero.lastRun"
  | "metric.passRate"
  | "metric.evalResults"
  | "metric.duration"
  | "metric.cost"
  | "section.experiments"
  | "section.individualRuns"
  | "section.traces"
  | "search.experiments"
  | "search.runs"
  | "empty.summary"
  | "empty.individualRuns"
  | "empty.runsFilter"
  | "empty.traces"
  | "table.experiment"
  | "table.model"
  | "table.agent"
  | "table.avgDuration"
  | "table.successRate"
  | "table.tokens"
  | "table.estCost"
  | "table.outcomes"
  | "table.evalId"
  | "table.outcome"
  | "table.ranAt"
  | "detail.evalResult"
  | "detail.evalResults"
  | "detail.attempts"
  | "detail.evals"
  | "detail.runs"
  | "detail.runsUnit"
  | "detail.passed"
  | "detail.failed"
  | "detail.errored"
  | "detail.totalTime"
  | "detail.totalCost"
  | "detail.ran"
  | "detail.evaluationAttempts"
  | "detail.status"
  | "detail.eval"
  | "detail.reason"
  | "detail.time"
  | "detail.run"
  | "detail.rawSample"
  | "detail.rawNote"
  | "config.experiment"
  | "config.flagsNone"
  | "config.default"
  | "config.none"
  | "config.notApplicable"
  | "status.pass"
  | "status.fail"
  | "status.error"
  | "status.skipped"
  | "action.close"
  | "action.copyReason"
  | "action.copyErrors"
  | "action.copied"
  | "trace.loading"
  | "trace.loadFailed"
  | "trace.transcript"
  | "trace.timing"
  | "trace.noSpans"
  | "trace.total"
  | "trace.spans"
  | "trace.clickDetails"
  | "transcript.noEvents"
  | "transcript.user"
  | "transcript.assistant"
  | "transcript.thinking"
  | "transcript.inputRequested"
  | "transcript.awaitingInput"
  | "transcript.contextCompacted"
  | "transcript.running"
  | "transcript.input"
  | "transcript.output"
  | "transcript.empty"
  | "code.otherAssertions"
  | "code.noReply"
  | "code.reply"
  | "code.hide"
  | "code.checks"
  | "code.conversation"
  | "code.noSource"
  | "assert.pass"
  | "assert.fail"
  | "assert.soft"
  | "assert.evidence"
  | "outcome.passed"
  | "outcome.failed"
  | "outcome.errored"
  | "outcome.skipped"
  | "banner.incompatibleTitle";

type Dictionary = Record<MessageKey, string>;

const dictionaries: Record<Locale, Dictionary> = {
  en: {
    "app.title": "niceeval experiment view",
    "nav.label": "Report",
    "nav.experiments": "Experiments",
    "nav.runs": "Runs",
    "nav.traces": "Traces",
    "hero.title": "Eval Run Results",
    "hero.lastRun": "Last run:",
    "metric.passRate": "Pass Rate",
    "metric.evalResults": "Eval Results",
    "metric.duration": "Duration",
    "metric.cost": "Estimated Cost",
    "section.experiments": "Experiments",
    "section.individualRuns": "Individual Runs",
    "section.traces": "Traces",
    "search.experiments": "Filter experiment, agent, model, or eval...",
    "search.runs": "Filter eval ID or experiment...",
    "empty.summary": "No summary.json files found. Run niceeval or pass niceeval view path/to/summary.json.",
    "empty.individualRuns": "No individual runs found.",
    "empty.runsFilter": "No results match the filter.",
    "empty.traces": "No traces available. Traces are collected during eval runs when artifacts are saved.",
    "table.experiment": "Experiment",
    "table.model": "Model",
    "table.agent": "Agent",
    "table.avgDuration": "Avg Duration",
    "table.successRate": "Success Rate",
    "table.tokens": "Tokens",
    "table.estCost": "Est. Cost",
    "table.outcomes": "Outcomes",
    "table.evalId": "Eval ID",
    "table.outcome": "Outcome",
    "table.ranAt": "Ran At",
    "detail.evalResult": "eval",
    "detail.evalResults": "evals",
    "detail.attempts": "Attempts",
    "detail.evals": "Evals",
    "detail.runs": "Runs",
    "detail.runsUnit": "runs",
    "detail.passed": "Passed",
    "detail.failed": "Failed",
    "detail.errored": "Errored",
    "detail.totalTime": "Total Time",
    "detail.totalCost": "Total Cost",
    "detail.ran": "Ran",
    "detail.evaluationAttempts": "Evals",
    "detail.status": "Status",
    "detail.eval": "Eval",
    "detail.reason": "Reason",
    "detail.time": "Time",
    "detail.run": "Run",
    "detail.rawSample": "Raw sample result",
    "detail.rawNote": "debug JSON, defaults to first error/failure when available",
    "config.experiment": "experiment",
    "config.flagsNone": "none",
    "config.default": "default",
    "config.none": "none",
    "config.notApplicable": "n/a",
    "status.pass": "pass",
    "status.fail": "fail",
    "status.error": "error",
    "status.skipped": "skipped",
    "action.close": "Close",
    "action.copyReason": "Copy reason",
    "action.copyErrors": "Copy errors",
    "action.copied": "Copied",
    "trace.loading": "loading...",
    "trace.loadFailed": "load failed (static report has no server - use niceeval view):",
    "trace.transcript": "transcript",
    "trace.timing": "timing trace",
    "trace.noSpans": "no spans",
    "trace.total": "total",
    "trace.spans": "spans",
    "trace.clickDetails": "click a row for details",
    "transcript.noEvents": "no events",
    "transcript.user": "user",
    "transcript.assistant": "assistant",
    "transcript.thinking": "thinking",
    "transcript.inputRequested": "input requested",
    "transcript.awaitingInput": "(awaiting input)",
    "transcript.contextCompacted": "context compacted",
    "transcript.running": "running...",
    "transcript.input": "input",
    "transcript.output": "output",
    "transcript.empty": "(empty)",
    "code.otherAssertions": "other assertions",
    "code.noReply": "(no reply)",
    "code.reply": "reply",
    "code.hide": "hide",
    "code.checks": "checks",
    "code.conversation": "conversation",
    "code.noSource": "Source was not captured. This run may predate source-loc or the source may be unavailable. Re-run this eval to see the code view.",
    "assert.pass": "pass",
    "assert.fail": "fail",
    "assert.soft": "soft",
    "assert.evidence": "What was checked",
    "outcome.passed": "passed",
    "outcome.failed": "failed",
    "outcome.errored": "errors",
    "outcome.skipped": "skipped",
    "banner.incompatibleTitle": "Runs written by a different niceeval version (not shown here) — view each with the command on the right:",
  },
  "zh-CN": {
    "app.title": "niceeval 实验查看器",
    "nav.label": "报告",
    "nav.experiments": "实验",
    "nav.runs": "运行",
    "nav.traces": "追踪",
    "hero.title": "Eval 运行结果",
    "hero.lastRun": "最近运行:",
    "metric.passRate": "通过率",
    "metric.evalResults": "Eval 结果",
    "metric.duration": "耗时",
    "metric.cost": "预估成本",
    "section.experiments": "实验",
    "section.individualRuns": "单次运行",
    "section.traces": "追踪",
    "search.experiments": "筛选实验、agent、model 或 eval...",
    "search.runs": "筛选 eval ID 或实验...",
    "empty.summary": "没有找到 summary.json。请先运行 niceeval，或传入 niceeval view path/to/summary.json。",
    "empty.individualRuns": "没有单次运行结果。",
    "empty.runsFilter": "没有匹配筛选条件的结果。",
    "empty.traces": "没有可用追踪。保存工件的 eval run 会收集 traces。",
    "table.experiment": "实验",
    "table.model": "模型",
    "table.agent": "Agent",
    "table.avgDuration": "平均耗时",
    "table.successRate": "成功率",
    "table.tokens": "Tokens",
    "table.estCost": "预估成本",
    "table.outcomes": "结果",
    "table.evalId": "Eval ID",
    "table.outcome": "状态",
    "table.ranAt": "运行时间",
    "detail.evalResult": "个 eval",
    "detail.evalResults": "个 eval",
    "detail.attempts": "尝试",
    "detail.evals": "Eval 数",
    "detail.runs": "总轮次",
    "detail.runsUnit": "轮",
    "detail.passed": "通过",
    "detail.failed": "失败",
    "detail.errored": "错误",
    "detail.totalTime": "总耗时",
    "detail.totalCost": "总成本",
    "detail.ran": "运行",
    "detail.evaluationAttempts": "各 Eval",
    "detail.status": "状态",
    "detail.eval": "Eval",
    "detail.reason": "原因",
    "detail.time": "耗时",
    "detail.run": "轮次",
    "detail.rawSample": "原始样例结果",
    "detail.rawNote": "调试 JSON，默认选择第一条错误/失败",
    "config.experiment": "实验",
    "config.flagsNone": "无",
    "config.default": "默认",
    "config.none": "无",
    "config.notApplicable": "不适用",
    "status.pass": "通过",
    "status.fail": "失败",
    "status.error": "错误",
    "status.skipped": "跳过",
    "action.close": "关闭",
    "action.copyReason": "复制原因",
    "action.copyErrors": "复制错误",
    "action.copied": "已复制",
    "trace.loading": "加载中...",
    "trace.loadFailed": "加载失败(静态报告没有服务端 - 请用 niceeval view):",
    "trace.transcript": "会话",
    "trace.timing": "耗时追踪",
    "trace.noSpans": "没有 span",
    "trace.total": "总计",
    "trace.spans": "spans",
    "trace.clickDetails": "点击行查看详情",
    "transcript.noEvents": "没有事件",
    "transcript.user": "user",
    "transcript.assistant": "assistant",
    "transcript.thinking": "thinking",
    "transcript.inputRequested": "请求输入",
    "transcript.awaitingInput": "(等待输入)",
    "transcript.contextCompacted": "上下文已压缩",
    "transcript.running": "运行中...",
    "transcript.input": "输入",
    "transcript.output": "输出",
    "transcript.empty": "(空)",
    "code.otherAssertions": "其它断言",
    "code.noReply": "(无回复)",
    "code.reply": "回复",
    "code.hide": "收起",
    "code.checks": "检查",
    "code.conversation": "会话",
    "code.noSource": "源码未捕获。此 run 可能早于 source-loc，或源码不可读。重跑此 eval 即可看到代码视图。",
    "assert.pass": "通过",
    "assert.fail": "失败",
    "assert.soft": "soft",
    "assert.evidence": "实际被检查的内容",
    "outcome.passed": "通过",
    "outcome.failed": "失败",
    "outcome.errored": "错误",
    "outcome.skipped": "跳过",
    "banner.incompatibleTitle": "以下 run 由其它版本的 niceeval 写入,此处不展示;用右侧命令查看:",
  },
};

const storageKey = "niceeval:view:locale";

export function detectLocale(): Locale {
  const stored = readStoredLocale();
  if (stored) return stored;
  const candidates = typeof navigator === "undefined" ? [] : [navigator.language, ...(navigator.languages ?? [])];
  return candidates.some((value) => value.toLowerCase().startsWith("zh")) ? "zh-CN" : "en";
}

export function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(storageKey, locale);
  } catch {
    // Reports must still work from local files and locked-down browsers.
  }
}

export function setDocumentLocale(locale: Locale): void {
  document.documentElement.lang = locale;
  document.title = dictionaries[locale]["app.title"];
}

export function makeTranslator(locale: Locale): (key: MessageKey) => string {
  return (key) => dictionaries[locale][key];
}

function readStoredLocale(): Locale | undefined {
  try {
    const value = localStorage.getItem(storageKey);
    return value === "zh-CN" || value === "en" ? value : undefined;
  } catch {
    return undefined;
  }
}
