// ScopeSummary:一个范围的摘要卡——快照时间窗、experiment / eval / attempt 数、判定计票、
// 端到端通过率与总成本。data 恒携带 eval 级与 attempt 级两份计票;呈现 prop `votes`
// 只选择显示哪一级(默认 "eval"),不改变 data。通过率与总成本只渲染算好的 MetricCell,
// 不现场重算(docs/feature/reports/components/summaries/sample-summary.md)。

import type { ReactElement } from "react";
import type { SampleSummaryContent, VerdictTally } from "../../model/types.ts";
import { DEFAULT_REPORT_LOCALE, localeText, type ReportLocale } from "../../model/locale.ts";
import { formatReportDateTime, formatReportDateTimeRange } from "../../model/format.ts";
import { MetricCellView } from "../cell.tsx";
import { cx } from "../shared.ts";

function VerdictTallyView({ tally, locale }: { tally: VerdictTally; locale: ReportLocale }): ReactElement {
  const kinds = (["passed", "failed", "errored", "unreadable"] as const).filter((k) => tally[k] > 0);
  return (
    <span className="nre-verdict-tally">
      {kinds.map((kind) => (
        <span key={kind} className={cx("nre-verdict-pill", `nre-verdict-${kind}`)}>
          {tally[kind]} {localeText(locale, `verdict.${kind}`)}
        </span>
      ))}
      {kinds.length === 0 && <span className="nre-missing">—</span>}
    </span>
  );
}

export function SampleSummary({
  data,
  votes = "eval",
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  data: SampleSummaryContent;
  /** 显示哪一级计票;默认 "eval"。data 恒携带两级,votes 只选择呈现。 */
  votes?: "eval" | "attempt";
  className?: string;
  locale?: ReportLocale;
}): ReactElement {
  const tally = votes === "attempt" ? data.attemptVerdicts : data.evalVerdicts;
  const formattedRange =
    data.range.earliestStartedAt !== null && data.range.latestStartedAt !== null
      ? formatReportDateTimeRange(data.range.earliestStartedAt, data.range.latestStartedAt, locale)
      : null;
  return (
    <div className={cx("nre", "nre-scope-summary", className)} data-votes={votes}>
      <dl className="nre-scope-kpis">
        {/* 计分制 Sample 隐藏通过率只显示总分;混型 Sample 两者都显示;纯通过制 Sample 只显示
            通过率(现状不变),见 docs/feature/reports/components/summaries/sample-summary.md。 */}
        {data.scoringComposition !== "points" && (
          <div className="nre-scope-kpi nre-scope-kpi-rate">
            <dt>{localeText(locale, "scopeSummary.passRate")}</dt>
            <dd>
              <MetricCellView cell={data.endToEndPassRate} locale={locale} />
            </dd>
          </div>
        )}
        {data.totalScore !== undefined && (
          <div className="nre-scope-kpi nre-scope-kpi-rate">
            <dt>{localeText(locale, "scopeSummary.totalScore")}</dt>
            <dd>
              <MetricCellView cell={data.totalScore} locale={locale} />
            </dd>
          </div>
        )}
        <div className="nre-scope-kpi">
          <dt>{localeText(locale, "scopeSummary.experiments")}</dt>
          <dd>{data.experiments}</dd>
        </div>
        <div className="nre-scope-kpi">
          <dt>{localeText(locale, "scopeSummary.evals")}</dt>
          <dd>{data.evals}</dd>
        </div>
        <div className="nre-scope-kpi">
          <dt>{localeText(locale, "scopeSummary.attempts")}</dt>
          <dd>{data.attempts}</dd>
        </div>
        <div className="nre-scope-kpi nre-scope-kpi-verdicts">
          <dt>{localeText(locale, votes === "attempt" ? "scopeSummary.votesAttempt" : "scopeSummary.votesEval")}</dt>
          <dd>
            <VerdictTallyView tally={tally} locale={locale} />
          </dd>
        </div>
        <div className="nre-scope-kpi">
          <dt>{localeText(locale, "scopeSummary.totalCost")}</dt>
          <dd>
            <MetricCellView cell={data.totalCostUSD} locale={locale} showCoverage={false} />
            {data.totalCostUSD.samples < data.totalCostUSD.total && (
              <small className="nre-scope-kpi-note">
                {localeText(locale, "scopeSummary.costCoverage", {
                  samples: data.totalCostUSD.samples,
                  total: data.totalCostUSD.total,
                })}
              </small>
            )}
          </dd>
        </div>
      </dl>
      {/* 时间窗:贡献当前数据的快照 startedAt 范围;空范围不编造当前时间 */}
      {data.range.latestStartedAt !== null && (
        <p className="nre-scope-summary-range">
          {data.range.earliestStartedAt !== null && data.range.earliestStartedAt !== data.range.latestStartedAt
            ? localeText(locale, "scopeSummary.runRange", {
                from: formattedRange!.from,
                to: formattedRange!.to,
              })
            : localeText(locale, "scopeSummary.lastRun", {
                time: formatReportDateTime(data.range.latestStartedAt, locale),
              })}
        </p>
      )}
    </div>
  );
}
