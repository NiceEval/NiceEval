// view 前端 i18n:内核(插值/归一)在 src/i18n/core.ts;这里只注入
// localStorage + navigator 的 locale 来源与 en 默认值。字典与 CLI 侧分开维护。

import { interpolate, normalizeLocale, type Locale, type Vars } from "../../i18n/core.ts";

export type MessageKey =
  | "app.title"
  | "nav.label"
  | "nav.report"
  | "nav.experiments"
  | "nav.attempts"
  | "nav.traces"
  | "hero.title"
  | "hero.lastRun"
  | "hero.noRuns"
  | "metric.passRate"
  | "metric.evalResults"
  | "metric.duration"
  | "metric.cost"
  | "section.experiments"
  | "section.attempts"
  | "section.traces"
  | "search.experiments"
  | "search.attempts"
  | "empty.summary"
  | "empty.attempts"
  | "empty.attemptsFilter"
  | "empty.traces"
  | "table.experiment"
  | "table.model"
  | "table.agent"
  | "table.avgDuration"
  | "table.successRate"
  | "table.tokens"
  | "table.estCost"
  | "table.verdicts"
  | "table.evalId"
  | "table.verdict"
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
  | "action.copyPrompt"
  | "action.copied"
  | "trace.loading"
  | "trace.loadFailed"
  | "trace.transcript"
  | "trace.timing"
  | "trace.noSpans"
  | "trace.total"
  | "trace.spans"
  | "trace.clickDetails"
  | "trace.enableHint"
  | "trace.enableHintLink"
  | "trace.enableHintUrl"
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
  | "code.sourceUnavailable"
  | "attempt.timing"
  | "attempt.teardown"
  | "attempt.diagnostics"
  | "assert.pass"
  | "assert.fail"
  | "assert.passedCollapsed"
  | "assert.unavailable"
  | "assert.optional"
  | "assert.soft"
  | "assert.evidence"
  | "verdict.passed"
  | "verdict.failed"
  | "verdict.errored"
  | "verdict.skipped"
  | "banner.skippedTitle"
  | "banner.skipped.incompatible"
  | "banner.skipped.incompatibleForeign"
  | "banner.skipped.malformed"
  | "banner.skipped.incomplete"
  | "banner.expandRest"
  | "banner.collapse"
  | "banner.copyCommand"
  | "banner.warningsTitle"
  | "hero.composedFrom"
  | "chart.costVsScore"
  | "chart.axisCost"
  | "chart.axisScore";

type Dictionary = Record<MessageKey, string>;

const dictionaries: Record<Locale, Dictionary> = {
  en: {
    "app.title": "niceeval experiment view",
    "nav.label": "Report",
    "nav.report": "Report",
    "nav.experiments": "Experiments",
    "nav.attempts": "Attempts",
    "nav.traces": "Traces",
    // 标题回退链终点的内置文案(shell.md:「Eval 运行结果 / Eval Results」);
    // 正常路径 server 侧已走完回退链,这里只兜旧数据 / 缺声明。
    "hero.title": "Eval Results",
    "hero.lastRun": "Last run:",
    "hero.noRuns": "No runs yet",
    "metric.passRate": "Pass Rate",
    "metric.evalResults": "Eval Results",
    "metric.duration": "Duration",
    "metric.cost": "Estimated Cost",
    "section.experiments": "Experiments",
    "section.attempts": "Attempts",
    "section.traces": "Traces",
    "search.experiments": "Filter experiment, agent, model, or eval...",
    "search.attempts": "Filter eval ID or experiment...",
    "empty.summary": "No snapshots found. Run niceeval or pass niceeval view path/to/snapshot.json.",
    "empty.attempts": "No attempts found.",
    "empty.attemptsFilter": "No results match the filter.",
    "empty.traces": "No traces available. Traces are collected during eval runs when artifacts are saved.",
    "table.experiment": "Experiment",
    "table.model": "Model",
    "table.agent": "Agent",
    "table.avgDuration": "Avg Duration",
    "table.successRate": "Success Rate",
    "table.tokens": "Tokens",
    "table.estCost": "Est. Cost",
    "table.verdicts": "Verdicts",
    "table.evalId": "Eval ID",
    "table.verdict": "Verdict",
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
    "action.copyPrompt": "Copy fix prompt",
    "action.copied": "Copied",
    "trace.loading": "loading...",
    "trace.loadFailed": "load failed (static report has no server - use niceeval view):",
    "trace.transcript": "transcript",
    "trace.timing": "timing trace",
    "trace.noSpans": "no spans",
    "trace.total": "total",
    "trace.spans": "spans",
    "trace.clickDetails": "click a row for details",
    "trace.enableHint": "No trace for this run. Wire up OTel to get a call waterfall — see the ",
    "trace.enableHintLink": "OTel guide",
    "trace.enableHintUrl": "https://niceeval.com/docs/guides/connect-otel",
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
    "code.sourceUnavailable": "Source was captured for this run, but its artifact files are missing from this deployment. Re-export with `niceeval view --out <dir>` (directory mode bundles artifacts), or open the results locally with `niceeval view`.",
    "attempt.timing": "timing",
    "attempt.teardown": "teardown (not counted in total)",
    "attempt.diagnostics": "diagnostics",
    "assert.pass": "pass",
    "assert.fail": "fail",
    "assert.passedCollapsed": "{{count}} passed",
    "assert.unavailable": "unavailable",
    "assert.optional": "optional",
    "assert.soft": "soft",
    "assert.evidence": "What was checked",
    "verdict.passed": "passed",
    "verdict.failed": "failed",
    "verdict.errored": "errors",
    "verdict.skipped": "skipped",
    "banner.skippedTitle": "{{count}} run(s) could not be loaded and are not shown here",
    "banner.skipped.incompatible": "written by niceeval {{producer}} (schemaVersion {{schemaVersion}}) — current version can't read it, expand for the view command",
    "banner.skipped.incompatibleForeign": "written by {{name}} {{version}} (schemaVersion {{schemaVersion}}) — this viewer cannot read them; open with the tool that produced them",
    "banner.skipped.malformed": "unreadable report ({{detail}}) — may be corrupted; re-run the eval or delete the run directory",
    "banner.skipped.incomplete": "snapshot.json was never written (a narrow crash window) — completed attempt artifacts remain on disk for manual inspection; delete the directory if you no longer need them",
    "banner.expandRest": "Show {{count}} more",
    "banner.collapse": "Collapse",
    "banner.copyCommand": "Copy view command",
    "banner.warningsTitle": "Heads-up about the current leaderboard selection:",
    "hero.composedFrom": "Composed from {{count}} run(s)",
    "chart.costVsScore": "Cost vs. Score",
    "chart.axisCost": "Avg cost per eval",
    "chart.axisScore": "Pass rate",
  },
  "zh-CN": {
    "app.title": "niceeval 实验查看器",
    "nav.label": "报告",
    "nav.report": "报告",
    "nav.experiments": "实验",
    "nav.attempts": "Attempts",
    "nav.traces": "追踪",
    "hero.title": "Eval 运行结果",
    "hero.lastRun": "最近运行:",
    "hero.noRuns": "还没有运行",
    "metric.passRate": "通过率",
    "metric.evalResults": "Eval 结果",
    "metric.duration": "耗时",
    "metric.cost": "预估成本",
    "section.experiments": "实验",
    "section.attempts": "Attempts",
    "section.traces": "追踪",
    "search.experiments": "筛选实验、agent、model 或 eval...",
    "search.attempts": "筛选 eval ID 或实验...",
    "empty.summary": "没有找到快照。请先运行 niceeval，或传入 niceeval view path/to/snapshot.json。",
    "empty.attempts": "还没有 attempt。",
    "empty.attemptsFilter": "没有匹配筛选条件的结果。",
    "empty.traces": "没有可用追踪。保存 artifact 的 eval run 会收集 traces。",
    "table.experiment": "实验",
    "table.model": "模型",
    "table.agent": "Agent",
    "table.avgDuration": "平均耗时",
    "table.successRate": "成功率",
    "table.tokens": "Tokens",
    "table.estCost": "预估成本",
    "table.verdicts": "结果",
    "table.evalId": "Eval ID",
    "table.verdict": "状态",
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
    "action.copyPrompt": "复制修复 Prompt",
    "action.copied": "已复制",
    "trace.loading": "加载中...",
    "trace.loadFailed": "加载失败(静态报告没有服务端 - 请用 niceeval view):",
    "trace.transcript": "会话",
    "trace.timing": "耗时追踪",
    "trace.noSpans": "没有 span",
    "trace.total": "总计",
    "trace.spans": "spans",
    "trace.clickDetails": "点击行查看详情",
    "trace.enableHint": "这次运行没有 trace。接入 OTel 才有调用瀑布图——看",
    "trace.enableHintLink": "OTel 接入指南",
    "trace.enableHintUrl": "https://niceeval.com/docs/zh/how-to/connect-otel",
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
    "code.sourceUnavailable": "此 run 捕获过源码，但当前部署里缺少它的 artifact 文件。用 `niceeval view --out <目录>` 重新导出（目录模式会带上 artifact），或在本地 `niceeval view` 查看。",
    "attempt.timing": "耗时",
    "attempt.teardown": "收尾(不计入总耗时)",
    "attempt.diagnostics": "诊断",
    "assert.pass": "通过",
    "assert.fail": "失败",
    "assert.passedCollapsed": "{{count}} 条通过",
    "assert.unavailable": "评不了",
    "assert.optional": "可缺席",
    "assert.soft": "soft",
    "assert.evidence": "实际被检查的内容",
    "verdict.passed": "通过",
    "verdict.failed": "失败",
    "verdict.errored": "错误",
    "verdict.skipped": "跳过",
    "banner.skippedTitle": "{{count}} 个 run 读取失败,此处不展示",
    "banner.skipped.incompatible": "由 niceeval {{producer}} 写入(schemaVersion {{schemaVersion}})—— 当前版本读不了,展开查看命令",
    "banner.skipped.incompatibleForeign": "由 {{name}} {{version}} 写入(schemaVersion {{schemaVersion}})—— 当前查看器读不了;请用写出它的工具查看",
    "banner.skipped.malformed": "报告读不了({{detail}})—— 可能已损坏;重跑该 eval 或删除对应 run 目录",
    "banner.skipped.incomplete": "快照目录已创建但从未写出 snapshot.json(极窄的崩溃窗口)—— 已完成的 attempt artifact 仍在盘上供手工排查;不需要就删除对应目录",
    "banner.expandRest": "展开其余 {{count}} 个",
    "banner.collapse": "收起",
    "banner.copyCommand": "复制查看命令",
    "banner.warningsTitle": "当前榜单挑选的提醒:",
    "hero.composedFrom": "合成自 {{count}} 个 run",
    "chart.costVsScore": "成本 × 通过率",
    "chart.axisCost": "平均每个 eval 成本",
    "chart.axisScore": "通过率",
  },
};

const storageKey = "niceeval:view:locale";

export function detectLocale(): Locale {
  const stored = readStoredLocale();
  if (stored) return stored;
  const candidates = typeof navigator === "undefined" ? [] : [navigator.language, ...(navigator.languages ?? [])];
  return candidates.some((value) => normalizeLocale(value) === "zh-CN") ? "zh-CN" : "en";
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

export function makeTranslator(locale: Locale): (key: MessageKey, vars?: Vars) => string {
  return (key, vars) => interpolate(dictionaries[locale][key], vars);
}

function readStoredLocale(): Locale | undefined {
  try {
    const value = localStorage.getItem(storageKey);
    return value === "zh-CN" || value === "en" ? value : undefined;
  } catch {
    return undefined;
  }
}
