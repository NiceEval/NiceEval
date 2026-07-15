// ExperimentComparison 的 web 面：完整持有所有可比组，组选择只切换已经独立计算好的 panel。
// 静态 HTML 用原生 <details> 保留每组完整内容；enhance.js 再把上方摘要卡变成单选切换。

import type { ReactElement } from "react";
import type { ExperimentComparisonData } from "../built-ins/experiment-comparison.tsx";
import { DEFAULT_REPORT_LOCALE, localeText, type ReportLocale } from "../locale.ts";
import { ExperimentList, MetricScatter } from "../components.tsx";
import { GroupSummary } from "./GroupSummary.tsx";
import { cx } from "./format.ts";

export function ExperimentComparisonView({
  data,
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  data: ExperimentComparisonData;
  className?: string;
  locale?: ReportLocale;
}): ReactElement {
  if (data.groups.length === 0) {
    return (
      <div className={cx("nre", "nre-experiment-comparison", className)}>
        <p className="nre-experiment-groups-empty">{localeText(locale, "experimentComparison.empty")}</p>
      </div>
    );
  }

  return (
    <div className={cx("nre", "nre-experiment-comparison", className)} data-nre-experiment-groups>
      <div
        className="nre-experiment-group-tabs"
        role="tablist"
        aria-label={localeText(locale, "experimentComparison.groups")}
      >
        {data.groups.map((group, index) => (
          <div
            key={group.key}
            className="nre-experiment-group-tab"
            role="tab"
            tabIndex={index === 0 ? 0 : -1}
            aria-selected={index === 0 ? "true" : "false"}
            aria-label={localeText(locale, "experimentComparison.selectGroup", { group: group.key })}
            data-nre-experiment-group-select={index}
          >
            <strong className="nre-experiment-group-name">{group.key}</strong>
            <GroupSummary data={group.summary} locale={locale} />
          </div>
        ))}
      </div>

      <div className="nre-experiment-group-panels">
        {data.groups.map((group, index) => (
          <details
            key={group.key}
            className="nre-experiment-group-panel"
            data-nre-experiment-group-panel={index}
            role="tabpanel"
            open={index === 0}
          >
            <summary>{group.key}</summary>
            <MetricScatter data={group.scatter} locale={locale} />
            <ExperimentList items={group.experiments} filter locale={locale} relativeTo={group.key} />
          </details>
        ))}
      </div>
    </div>
  );
}
