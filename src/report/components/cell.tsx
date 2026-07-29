// MetricValue 的统一渲染:覆盖率角标、缺数据文案、证据链接只实现一次。
// 纯渲染、零 hooks;交互只有普通 <a>(下钻由使用者的 attemptHref 决定去处)。
// 显示值在渲染面按 unit/format 格式化，不预生成 display。

import type { ReactElement } from "react";
import type { MetricValue } from "../model/calculation.ts";
import type { AttemptLocator } from "../../record/locator.ts";
import { formatMetricValue } from "../model/format.ts";
import { countText, DEFAULT_REPORT_LOCALE, localeText, type ReportLocale } from "../model/locale.ts";

export function MetricCellView({
  cell,
  attemptHref,
  locale = DEFAULT_REPORT_LOCALE,
  showCoverage = true,
}: {
  cell: MetricValue;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  /** 默认用紧凑角标显示覆盖率；已有展开说明的摘要卡可关闭角标。 */
  showCoverage?: boolean;
}): ReactElement {
  const text = formatMetricValue(cell.value, cell.unit, cell.format, locale);
  if (cell.value === null) {
    return (
      <span className="niceeval-cell niceeval-cell-missing">
        <span className="niceeval-missing" title={localeText(locale, "cell.noneMeasurableTitle", { total: cell.total })}>
          {text}
        </span>
      </span>
    );
  }
  return (
    <span className="niceeval-cell">
      <span
        className="niceeval-value"
        title={localeText(locale, "cell.measuredTitle", { samples: cell.samples, total: cell.total })}
      >
        {text}
      </span>
      {showCoverage && cell.samples < cell.total && (
        <sup
          className="niceeval-coverage"
          title={localeText(locale, "cell.coverageTitle", { samples: cell.samples, total: cell.total })}
        >
          {cell.samples}/{cell.total}
        </sup>
      )}
      {attemptHref && cell.refs && cell.refs.length === 1 && (
        <span className="niceeval-refs">
          <a className="niceeval-ref" href={attemptHref(cell.refs[0]!)}>
            #1
          </a>
        </span>
      )}
      {attemptHref && cell.refs && cell.refs.length > 1 && (
        <details className="niceeval-refs">
          <summary className="niceeval-refs-summary">{countText(locale, "cell.evidence", cell.refs.length)}</summary>
          <span className="niceeval-refs-list">
            {cell.refs.map((locator, i) => (
              <a key={locator} className="niceeval-ref" href={attemptHref(locator)}>
                #{i + 1}
              </a>
            ))}
          </span>
        </details>
      )}
    </span>
  );
}
