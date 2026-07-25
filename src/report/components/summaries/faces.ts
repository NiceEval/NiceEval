// ScopeSummary 的 text 面:同一份算好的数据,渲染成终端字符(niceeval show 的形态)。
// 与 web 面共守诚实契约:排序随 better、samples < total 角标、缺数据 — 不补 0。
// 零 react、零 IO、纯同步。

import type { ScopeSummaryData } from "../../model/types.ts";
import type { TextContext } from "../../definition/tree.ts";
import { countText, localeText, resolveLocalizedText } from "../../model/locale.ts";
import { formatReportDateTime, formatReportDateTimeRange } from "../../model/format.ts";
import { wrapDisplay } from "../../model/text-layout.ts";
import { cellText, verdictTallyText, MISSING_MARK } from "../shared-faces.ts";

/**
 * 一至两行:头行是端到端通过率(官方 MetricCell,不重算)+ experiment/eval/attempt 数 +
 * `votes` 选中的那级计票 + 总成本;第二行(有则加)是快照时间窗。
 */
export function scopeSummaryText(data: ScopeSummaryData, votes: "eval" | "attempt", ctx: TextContext): string {
  const locale = ctx.locale;
  const tally = votes === "attempt" ? data.attemptVerdicts : data.evalVerdicts;
  const head = [
    // 计分制 Scope 隐藏通过率只显示总分;混型 Scope 两者都显示;纯通过制 Scope 只显示通过率
    // (现状不变),见 docs/feature/reports/components/summaries/sample-summary.md。
    ...(data.scoringComposition !== "points"
      ? [`${localeText(locale, "scopeSummary.passRate")} ${cellText(data.endToEndPassRate, locale)}`]
      : []),
    ...(data.totalScore !== undefined
      ? [`${localeText(locale, "scopeSummary.totalScore")} ${cellText(data.totalScore, locale)}`]
      : []),
    countText(locale, "overview.experiments", data.experiments),
    localeText(locale, "overview.evalsCount", { n: data.evals }),
    localeText(locale, "overview.attemptsCount", { n: data.attempts }),
    verdictTallyText(tally, locale),
    `${localeText(locale, "scopeSummary.totalCost")} ${
      data.totalCostUSD.value === null ? MISSING_MARK : resolveLocalizedText(data.totalCostUSD.display, locale)
    }${
      data.totalCostUSD.samples < data.totalCostUSD.total
        ? ` (${localeText(locale, "scopeSummary.costCoverage", {
            samples: data.totalCostUSD.samples,
            total: data.totalCostUSD.total,
          })})`
        : ""
    }`,
  ].join(" · ");
  // 头行拼接的字段较多,窄终端下按显示宽度折行(不截断内容)。
  const lines = wrapDisplay(head, ctx.width);
  if (data.range.latestStartedAt !== null) {
    const from = data.range.earliestStartedAt;
    const to = data.range.latestStartedAt;
    lines.push(
      from !== null && from !== to
        ? localeText(locale, "scopeSummary.runRange", formatReportDateTimeRange(from, to, locale))
        : localeText(locale, "scopeSummary.lastRun", { time: formatReportDateTime(to, locale) }),
    );
  }
  return lines.join("\n");
}
