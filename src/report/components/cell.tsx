// MetricCell 的统一渲染:MetricTable / MetricMatrix / DeltaTable 共用,
// 保证三处对同一份数据长得一致——覆盖率角标、缺数据文案、证据链接只实现一次。
// 纯渲染、零 hooks;交互只有普通 <a>(下钻由使用者的 attemptHref 决定去处)。

import type { ReactElement } from "react";
import type { MetricCell } from "../model/types.ts";
import type { AttemptLocator } from "../../record/locator.ts";
import { DEFAULT_REPORT_LOCALE, localeText, resolveLocalizedText, type ReportLocale } from "../model/locale.ts";

export function MetricCellView({
  cell,
  attemptHref,
  locale = DEFAULT_REPORT_LOCALE,
  showCoverage = true,
}: {
  cell: MetricCell;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  /** 默认用紧凑角标显示覆盖率；已有展开说明的摘要卡可关闭角标。 */
  showCoverage?: boolean;
}): ReactElement {
  // 全 null(没有任何有效样本)→ 缺数据文案,绝不画 0;total 仍如实入 title
  if (cell.value === null) {
    return (
      <span className="nre-cell nre-cell-missing">
        <span className="nre-missing" title={localeText(locale, "cell.noneMeasurableTitle", { total: cell.total })}>
          {localeText(locale, "cell.missing")}
        </span>
      </span>
    );
  }
  return (
    <span className="nre-cell">
      <span
        className="nre-value"
        title={localeText(locale, "cell.measuredTitle", { samples: cell.samples, total: cell.total })}
      >
        {resolveLocalizedText(cell.display, locale)}
      </span>
      {/* samples < total:有 attempt 测不了这个指标,覆盖率角标如实标出 */}
      {showCoverage && cell.samples < cell.total && (
        <sup
          className="nre-coverage"
          title={localeText(locale, "cell.coverageTitle", { samples: cell.samples, total: cell.total })}
        >
          {cell.samples}/{cell.total}
        </sup>
      )}
      {/* refs + attemptHref:格子可点,「给我看那次 attempt」就在手边 */}
      {attemptHref && cell.refs && cell.refs.length > 0 && (
        <span className="nre-refs">
          {cell.refs.map((locator, i) => (
            <a key={locator} className="nre-ref" href={attemptHref(locator)}>
              #{i + 1}
            </a>
          ))}
        </span>
      )}
    </span>
  );
}
