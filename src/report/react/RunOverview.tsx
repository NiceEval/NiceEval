// RunOverview:页头 KPI 条——「这批数据是什么」。
// 数字下面标注数据来源(几个快照、何时跑的);warnings 有内容时直接显示在条内,
// 诚实不靠使用者记得渲染(docs/feature/reports/library.md「RunOverview」行为清单)。

import type { ReactElement } from "react";
import type { OverviewData } from "../types.ts";
import { DEFAULT_REPORT_LOCALE, localeText, type ReportLocale } from "../locale.ts";
import { cx, formatDurationMs, formatUSD } from "./format.ts";

export function RunOverview({
  data,
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  data: OverviewData;
  className?: string;
  locale?: ReportLocale;
}): ReactElement {
  const { totals } = data;
  const missing = <span className="nre-missing">{localeText(locale, "cell.missing")}</span>;
  // 通过率只渲染 computeCell 算好的 MetricCell,不现场重算——覆盖率角标复用
  // MetricCellView 的缺数据/coverage 语义(缺数据 = 显式文案,绝不画 0%)
  const { passRate } = totals;
  const passRateNode =
    passRate.value === null ? (
      missing
    ) : (
      <>
        {passRate.display}
        {passRate.samples < passRate.total && (
          <sup
            className="nre-coverage"
            title={localeText(locale, "cell.coverageTitle", { samples: passRate.samples, total: passRate.total })}
          >
            {passRate.samples}/{passRate.total}
          </sup>
        )}
      </>
    );

  return (
    <header className={cx("nre", "nre-overview", className)}>
      <dl className="nre-kpis">
        <div className="nre-kpi">
          <dt>{localeText(locale, "overview.snapshots")}</dt>
          <dd>{data.snapshots.length}</dd>
        </div>
        <div className="nre-kpi">
          <dt>{localeText(locale, "overview.evals")}</dt>
          <dd>{totals.evals}</dd>
        </div>
        <div className="nre-kpi">
          <dt>{localeText(locale, "overview.attempts")}</dt>
          <dd>{totals.attempts}</dd>
        </div>
        <div className="nre-kpi">
          <dt>{localeText(locale, "overview.passRate")}</dt>
          <dd>{passRateNode}</dd>
        </div>
        <div className="nre-kpi">
          <dt>{localeText(locale, "overview.totalCost")}</dt>
          {/* costUSD 全缺 = null:显示缺数据,不编 $0 */}
          <dd>{totals.costUSD === null ? missing : formatUSD(totals.costUSD)}</dd>
        </div>
        <div className="nre-kpi">
          <dt>{localeText(locale, "overview.totalDuration")}</dt>
          <dd>{formatDurationMs(totals.durationMs)}</dd>
        </div>
      </dl>

      <p className="nre-verdicts">
        <span className="nre-verdict nre-verdict-passed">
          {localeText(locale, "verdict.passed")} {totals.passed}
        </span>
        <span className="nre-verdict nre-verdict-failed">
          {localeText(locale, "verdict.failed")} {totals.failed}
        </span>
        <span className="nre-verdict nre-verdict-errored">
          {localeText(locale, "verdict.errored")} {totals.errored}
        </span>
        <span className="nre-verdict nre-verdict-skipped">
          {localeText(locale, "verdict.skipped")} {totals.skipped}
        </span>
      </p>

      {/* 数据来源:哪些快照、何时跑的——报告的数字都从这里来 */}
      <p className="nre-source">
        {localeText(locale, "overview.source", { n: data.snapshots.length })}
        {data.snapshots.map((s) => (
          <span key={`${s.experimentId}@${s.startedAt}`} className="nre-source-snapshot">
            {s.experimentId}({s.agent}
            {s.model ? ` · ${s.model}` : ""})@ {s.startedAt}
          </span>
        ))}
      </p>

      {/* Selection 的警告(残缺快照等)直接渲染在条内,不静默;结构化字段供程序判断,这里打 message */}
      {data.warnings.length > 0 && (
        <ul className="nre-warnings">
          {data.warnings.map((w, i) => (
            <li key={i} className="nre-warning" data-kind={w.kind}>
              {w.message}
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}
