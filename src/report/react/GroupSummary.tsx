// GroupSummary:一组 experiment(如自定义报告里同一 <Section> 内的全部 experiment)的
// 紧凑摘要块——恢复旧 GroupSelector 卡片的信息密度(通过率、experiment/eval 数、failed、
// errored、总成本、最后运行时间),但只渲染 GroupSummaryData 算好的 MetricCell / 计数,
// 不现场重算比例(docs/feature/reports/library.md「GroupSummary」)。errored 为 0 时省略该片段(旧卡片同一姿态),
// 但这只是渲染取舍——数据侧 verdicts.errored 字段本身永不省略。

import type { ReactElement } from "react";
import type { GroupSummaryData } from "../types.ts";
import { DEFAULT_REPORT_LOCALE, localeText, type ReportLocale } from "../locale.ts";
import { MetricCellView } from "./cell.tsx";
import { cx, formatUSD } from "./format.ts";

export function GroupSummary({
  data,
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  data: GroupSummaryData;
  className?: string;
  locale?: ReportLocale;
}): ReactElement {
  const missing = <span className="nre-missing">{localeText(locale, "cell.missing")}</span>;
  return (
    <div className={cx("nre", "nre-group-summary", className)}>
      <dl className="nre-group-kpis">
        <div className="nre-group-kpi nre-group-kpi-rate">
          <dt>{localeText(locale, "overview.passRate")}</dt>
          <dd>
            <MetricCellView cell={data.passRate} locale={locale} />
          </dd>
        </div>
        <div className="nre-group-kpi">
          <dt>{localeText(locale, "groupSummary.experiments")}</dt>
          <dd>{data.experiments}</dd>
        </div>
        <div className="nre-group-kpi">
          <dt>{localeText(locale, "overview.evals")}</dt>
          <dd>{data.evals}</dd>
        </div>
        <div className="nre-group-kpi">
          <dt>{localeText(locale, "overview.attempts")}</dt>
          <dd>{data.attempts}</dd>
        </div>
        <div className="nre-group-kpi">
          <dt>{localeText(locale, "verdict.failed")}</dt>
          <dd className="nre-verdict-failed">{data.verdicts.failed}</dd>
        </div>
        {/* errored 为 0 省略这一片段(旧 GroupSelector 卡片同一姿态);数据字段本身不受影响 */}
        {data.verdicts.errored > 0 && (
          <div className="nre-group-kpi">
            <dt>{localeText(locale, "verdict.errored")}</dt>
            <dd className="nre-verdict-errored">{data.verdicts.errored}</dd>
          </div>
        )}
        <div className="nre-group-kpi">
          <dt>{localeText(locale, "overview.totalCost")}</dt>
          {/* totalCostUSD 全缺 = null:显示缺数据,不编 $0 */}
          <dd>{data.totalCostUSD === null ? missing : formatUSD(data.totalCostUSD)}</dd>
        </div>
      </dl>
      {data.lastRunAt && (
        <p className="nre-group-summary-time">{localeText(locale, "latestRun", { run: data.lastRunAt })}</p>
      )}
    </div>
  );
}
