// MetricValue 的统一渲染:覆盖率角标、缺数据文案、证据链接只实现一次。
// 纯渲染、零 hooks;交互只有普通 <a>(下钻由调用方传入的 href 决定去处——每条 ref 各自经
// targetOfRefs([locator]) 换目标、再经 ctx.href 换 URL,不是靠 refs 数组整体求一个目标,
// library.md「目标与下钻」:「表格格子不受此限：每条 ref 各成一个单 locator 链接」)。
// 显示值在渲染面按 unit/format 格式化，不预生成 display。

import type { ReactElement } from "react";
import type { MetricValue } from "../model/calculation.ts";
import type { AttemptLocator } from "../../record/locator.ts";
import { formatMetricValue } from "../model/format.ts";
import { countText, DEFAULT_REPORT_LOCALE, localeText, type ReportLocale } from "../model/locale.ts";

export function MetricCellView({
  cell,
  href,
  locale = DEFAULT_REPORT_LOCALE,
  showCoverage = true,
}: {
  cell: MetricValue;
  /** 单个 locator → URL;缺省(宿主不认识 attempt 目标)时不出现证据链接。 */
  href?: (locator: AttemptLocator) => string | undefined;
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
      {href && cell.refs && cell.refs.length === 1 && href(cell.refs[0]!) !== undefined && (
        <span className="niceeval-refs">
          <a className="niceeval-ref" href={href(cell.refs[0]!)}>
            #1
          </a>
        </span>
      )}
      {href && cell.refs && cell.refs.length > 1 && (
        <details className="niceeval-refs">
          <summary className="niceeval-refs-summary">{countText(locale, "cell.evidence", cell.refs.length)}</summary>
          <span className="niceeval-refs-list">
            {cell.refs.map((locator, i) =>
              href(locator) !== undefined ? (
                <a key={locator} className="niceeval-ref" href={href(locator)}>
                  #{i + 1}
                </a>
              ) : (
                <span key={locator} className="niceeval-ref-text">
                  #{i + 1}
                </span>
              ),
            )}
          </span>
        </details>
      )}
    </span>
  );
}
