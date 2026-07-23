// 实体列表族(ExperimentList / EvalList / AttemptList)的 text 面:同一份算好的数据,
// 渲染成终端字符(niceeval show 的形态)。三面共用的紧凑标记:`locator✓`(判定符紧跟
// locator,中间不留空格)。ExperimentList / EvalList 逐 attempt 只列这一个标记 + 各自的
// 摘要,不重复整段 niceeval show 命令;要看某个 attempt 的完整证据,agent 自己拼
// `niceeval show <locator>`。零 react、零 IO、纯同步。

import type { AttemptListItem, EvalListItem, ExperimentListItem } from "../../model/types.ts";
import type { TextContext } from "../../definition/tree.ts";
import type { TableColumn, TableRow } from "../../definition/primitives.tsx";
import {
  experimentListScoringComposition,
  fitFailureSummary,
  formatDurationMs,
  formatHistoricalGap,
  formatUSD,
  shortestUniqueLabels,
  verdictMark,
} from "../../model/format.ts";
import { countText, localeText, type ReportLocale } from "../../model/locale.ts";
import { stringWidth, wrapDisplay } from "../../model/text-layout.ts";
import { renderTableText } from "../../definition/table-text.ts";
import { cellText, missingText, verdictTallyText, MISSING_MARK } from "../shared-faces.ts";

// ───────────────────────── 实体列表(ExperimentList / EvalList / AttemptList)─────────────────────────
//
// 三面共用的紧凑标记:`locator✓`(判定符紧跟 locator,中间不留空格)。
// ExperimentList / EvalList 逐 attempt 只列这一个标记 + 各自的摘要,不重复整段
// niceeval show 命令;要看某个 attempt 的完整证据,agent 自己拼 `niceeval show <locator>`。

function locatorBadge(item: { locator: string; verdict: AttemptListItem["verdict"] }): string {
  return `${item.locator}${verdictMark(item.verdict)}`;
}

/**
 * 时效标注(`↩` + 紧凑时距)的 text 面:历史执行(携带,或跨快照拼入)才输出,新执行为
 * 空串;三面(ExperimentList / EvalList / AttemptList)共用
 * (docs/feature/reports/library/entity-lists.md「时效标注」)。
 */
function historicalSuffix(item: Pick<AttemptListItem, "startedAt" | "historical">): string {
  return item.historical ? `   ↩ ${formatHistoricalGap(item.startedAt)}` : "";
}

/** Eval 父行的时效标注:全部 attempt 均为历史执行时,标最近一次执行的时距;新旧混合不标。 */
function evalHistoricalSuffix(attempts: readonly AttemptListItem[]): string {
  if (attempts.length === 0 || !attempts.every((a) => a.historical)) return "";
  const mostRecent = attempts.reduce((a, b) => (b.startedAt > a.startedAt ? b : a));
  return `   ↩ ${formatHistoricalGap(mostRecent.startedAt)}`;
}

/**
 * failureSummary + moreFailures 的展示形态:摘要在计算侧已按 Scoring display 契约折好,
 * 这里只加 "+N more failures" 计数与宽度收口,不重算摘要。
 */
function attemptReasonText(item: AttemptListItem, locale: ReportLocale, maxChars: number): string | undefined {
  if (item.failureSummary === null) return undefined;
  const withMore =
    item.moreFailures > 0
      ? `${item.failureSummary} · ${countText(locale, "entityList.moreFailures", item.moreFailures)}`
      : item.failureSummary;
  return fitFailureSummary(withMore, Math.max(24, maxChars));
}

// ── ExperimentList ──

function experimentSummaryTable(
  items: readonly ExperimentListItem[],
  ctx: TextContext,
  labels: Map<string, string>,
): string {
  const locale = ctx.locale;
  const compact = ctx.width < 100;
  // 主读数列按题型构成选择,与 web 面共用同一份判据(entity-lists.md「ExperimentList」)。
  const composition = experimentListScoringComposition(items);
  const showPassRate = composition !== "points";
  const showTotalScore = composition !== "pass";
  const columns: TableColumn[] = [
    { key: "experiment", header: compact && locale === "en" ? "Exp." : localeText(locale, "experimentList.experiment") },
    { key: "model", header: localeText(locale, "table.model") },
    { key: "agent", header: localeText(locale, "table.agent") },
    { key: "duration", header: compact && locale === "en" ? "Avg" : localeText(locale, "experimentList.avgDuration"), align: "right" },
  ];
  if (showPassRate) {
    columns.push({
      key: "passRate",
      header: compact && locale === "en" ? "Pass" : localeText(locale, "experimentList.passRate"),
      align: "right",
    });
  }
  if (showTotalScore) {
    columns.push({
      key: "totalScore",
      header: compact && locale === "en" ? "Score" : localeText(locale, "experimentList.totalScore"),
      align: "right",
    });
  }
  columns.push(
    { key: "result", header: localeText(locale, "experimentList.result") },
    { key: "tokens", header: localeText(locale, "experimentList.tokens"), align: "right" },
    { key: "cost", header: localeText(locale, "experimentList.cost"), align: "right" },
  );
  const rows: TableRow[] = items.map((item) => ({
    key: item.experimentId,
    cells: {
      experiment: labels.get(item.experimentId) ?? item.experimentId,
      model: item.model ?? localeText(locale, "experimentList.defaultModel"),
      agent: item.agent,
      duration: cellText(item.durationMs, locale),
      // 计分制行的通过率是可判定的真实数字,不是缺数据——mixed 表里强制显示 —,不让它冒充
      // 这一行的主读数(entity-lists.md「ExperimentList」)。
      ...(showPassRate ? { passRate: item.scoring === "points" ? MISSING_MARK : cellText(item.endToEndPassRate, locale) } : {}),
      // 通过制行的 totalScore 本就是 null cell,cellText 的缺数据渲染(—)已经够用,不需要强制。
      ...(showTotalScore ? { totalScore: cellText(item.totalScore, locale) } : {}),
      result: verdictTallyText(item.evalVerdicts, locale),
      tokens: cellText(item.tokens, locale),
      cost: cellText(item.costUSD, locale),
    },
  }));
  const metadata = items.flatMap((item) => {
    const evalsText =
      item.missingEvalIds.length > 0
        ? localeText(locale, "overview.evalsCountPartial", {
            covered: item.evals,
            total: item.evals + item.missingEvalIds.length,
          })
        : localeText(locale, "overview.evalsCount", { n: item.evals });
    const parts = [
      evalsText,
      localeText(locale, "overview.attemptsCount", { n: item.attempts }),
      ...(item.historicalAttempts > 0
        ? [localeText(locale, "experimentList.historicalAttempts", { n: item.historicalAttempts, m: item.attempts })]
        : []),
      item.lastRunAt,
    ];
    return wrapDisplay(
      `${labels.get(item.experimentId) ?? item.experimentId}: ${parts.join(" · ")}`,
      Math.max(8, ctx.width - 2),
    ).map((line) => `  ${line}`);
  });
  return [renderTableText({ columns: columns as unknown as [TableColumn, ...TableColumn[]], rows, locale }, ctx), metadata.join("\n")].join("\n");
}

function experimentDetailTable(item: ExperimentListItem, ctx: TextContext, label: string): string {
  const locale = ctx.locale;
  // 题型是定义期事实,单个 experiment 内由启动期强制同型:这里只需看这一个 item 的 scoring,
  // 不需要 experimentListScoringComposition 那份跨行判据。
  const showScore = item.scoring === "points";
  const columns: TableColumn[] = [
    { key: "status", header: localeText(locale, "experimentList.status") },
    { key: "entity", header: localeText(locale, "experimentList.evalAttempt") },
    // Result 是可扫读的失败预览,不是证据面:两行放不下的以 … 收口,完整值走 locator 下钻。
    { key: "result", header: localeText(locale, "experimentList.result"), maxLines: 2 },
    { key: "duration", header: localeText(locale, "experimentList.duration"), align: "right" },
    { key: "cost", header: localeText(locale, "experimentList.cost"), align: "right" },
  ];
  // 计分制实验:附一列挣分,Eval 父行是这道题的平均、Attempt 子行是这一轮的原始值
  // (与 duration/cost 的父行 avg、子行原始值同一惯例)。通过制实验没有这个读数,不摆占位列。
  if (showScore) {
    columns.push({ key: "score", header: localeText(locale, "experimentList.totalScore"), align: "right" });
  }
  // Result 的字符预算 ≈ 两行 × 它能分到的列宽(总宽减其它列的自然宽与列距)。这里只做
  // 粗预算;精确的按宽度收口由列的 maxLines 兜底。
  const statusWidth = Math.max(
    stringWidth(localeText(locale, "experimentList.status")),
    ...item.evalRows.map((row) => stringWidth(`${verdictMark(row.verdict)} ${localeText(locale, `verdict.${row.verdict}`)}`)),
  );
  const entityWidth = Math.max(
    stringWidth(localeText(locale, "experimentList.evalAttempt")),
    ...item.evalRows.flatMap((row) => [stringWidth(row.evalId), ...row.attempts.map((a) => stringWidth(a.locator) + 3)]),
  );
  const columnCount = showScore ? 6 : 5;
  const fixedWidth =
    statusWidth + entityWidth + 8 /* duration */ + 6 /* cost */ + (showScore ? 8 : 0) /* score */ + 3 * (columnCount - 1); /* 列距 */
  const resultBudget = Math.max(24, (ctx.width - fixedWidth) * 2);
  const rows: TableRow[] = item.evalRows.flatMap((row) => {
    // Eval 父行只承载折叠判定与题级聚合;失败摘要只在 Attempt 子行出现。
    const parent: TableRow = {
      key: row.evalId,
      cells: {
        status: `${verdictMark(row.verdict)} ${localeText(locale, `verdict.${row.verdict}`)}`,
        entity: `${row.evalId}${evalHistoricalSuffix(row.attempts)}`,
        result: "",
        duration: localeText(locale, "entityList.average", { value: cellText(row.durationMs, locale) }),
        cost: localeText(locale, "entityList.average", { value: cellText(row.costUSD, locale) }),
        ...(showScore ? { score: localeText(locale, "entityList.average", { value: cellText(row.totalScore, locale) }) } : {}),
      },
    };
    const attempts: TableRow[] = row.attempts.map((attempt, index) => ({
      key: attempt.locator,
      cells: {
        status: `  ${verdictMark(attempt.verdict)}`,
        entity: `${index === row.attempts.length - 1 ? "└─" : "├─"} ${attempt.locator}${historicalSuffix(attempt)}`,
        result: attemptReasonText(attempt, locale, resultBudget) ?? MISSING_MARK,
        duration: attempt.verdict === "skipped" && attempt.durationMs === 0 ? null : formatDurationMs(attempt.durationMs),
        cost: attempt.costUSD === null ? null : formatUSD(attempt.costUSD),
        ...(showScore ? { score: cellText(attempt.totalScore, locale) } : {}),
      },
    }));
    return [parent, ...attempts];
  });
  // 覆盖缺口的占位行:状态列为 —,结果列为「当前配置下无结果」+ 可复制的补跑命令,
  // 无 attempt 子行,duration/cost 留空(不参与任何指标聚合)。
  const missingRows: TableRow[] = item.missingEvalIds.map((evalId) => ({
    key: evalId,
    cells: {
      status: MISSING_MARK,
      entity: evalId,
      result: `${localeText(locale, "experimentList.noResultsForConfig")} · niceeval exp ${item.experimentId}`,
      duration: null,
      cost: null,
      ...(showScore ? { score: null } : {}),
    },
  }));
  rows.push(...missingRows);
  const flags = item.flags && Object.keys(item.flags).length > 0
    ? `${localeText(locale, "experimentList.flags")} ${Object.entries(item.flags)
        .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
        .join(" · ")}`
    : undefined;
  return [
    label,
    flags,
    renderTableText({ columns: columns as unknown as [TableColumn, ...TableColumn[]], rows, locale }, ctx),
  ]
    .filter(Boolean)
    .join("\n");
}

export function experimentListText(items: readonly ExperimentListItem[], ctx: TextContext): string {
  if (items.length === 0) return localeText(ctx.locale, "attemptList.empty");
  const labels = shortestUniqueLabels(items.map((item) => item.experimentId));
  return [
    experimentSummaryTable(items, ctx, labels),
    ...items.map((item) => experimentDetailTable(item, ctx, labels.get(item.experimentId) ?? item.experimentId)),
  ].join("\n\n");
}

// ── EvalList ──

function evalListAttemptLine(item: AttemptListItem, ctx: TextContext): string {
  // 行式列表同守「Result 最多两行」:预算 = 两行终端宽,超出按尾截收口。
  const reason = attemptReasonText(item, ctx.locale, ctx.width * 2 - stringWidth(locatorBadge(item)) - 6);
  return `  ${locatorBadge(item)}${historicalSuffix(item)}${reason ? ` · ${reason}` : ""}`;
}

export function evalListText(items: readonly EvalListItem[], ctx: TextContext): string {
  const locale = ctx.locale;
  if (items.length === 0) return localeText(locale, "attemptList.empty");
  const blocks = items.map((item) => {
    const identity = `${item.evalId}${evalHistoricalSuffix(item.attempts)} · ${item.experimentId} · ${localeText(locale, `verdict.${item.verdict}`)}`;
    const summary = [
      localeText(locale, "attemptList.score", { score: cellText(item.examScore, locale) }),
      localeText(locale, "overview.attemptsCount", { n: item.attempts.length }),
      localeText(locale, "entityList.average", {
        value: item.durationMs.value === null ? missingText(locale) : formatDurationMs(item.durationMs.value),
      }),
      localeText(locale, "entityList.average", {
        value: item.costUSD.value === null ? missingText(locale) : formatUSD(item.costUSD.value),
      }),
    ].join(" · ");
    const attemptLines = item.attempts.map((attempt) => evalListAttemptLine(attempt, ctx));
    return [identity, `  ${summary}`, ...attemptLines].join("\n");
  });
  return blocks.join("\n\n");
}

// ── AttemptList ──

/** Attempt 比较卡片:只显示一条主失败摘要(至多两行终端宽);完整 assertions 走 locator 下钻。 */
function attemptListItemText(item: AttemptListItem, ctx: TextContext): string {
  const head = [
    `${verdictMark(item.verdict)} ${item.locator}${historicalSuffix(item)}`,
    item.evalId,
    item.experimentId,
    formatDurationMs(item.durationMs),
    ...(item.costUSD !== null ? [formatUSD(item.costUSD)] : []),
  ].join(" · ");
  const lines = [head];
  const reason = attemptReasonText(item, ctx.locale, ctx.width * 2 - 4);
  if (reason) lines.push(`  ${reason}`);
  return lines.join("\n");
}

export function attemptListText(items: readonly AttemptListItem[], total: number | undefined, ctx: TextContext): string {
  const locale = ctx.locale;
  if (items.length === 0) return localeText(locale, "attemptList.empty");
  const blocks = items.map((item) => attemptListItemText(item, ctx));
  const remaining = (total ?? items.length) - items.length;
  if (remaining > 0) blocks.push(localeText(locale, "attemptList.truncatedText", { n: remaining }));
  return blocks.join("\n\n");
}
