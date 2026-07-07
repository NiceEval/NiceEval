// MetricCell 的统一渲染:MetricTable / MetricMatrix / DeltaTable 共用,
// 保证三处对同一份数据长得一致——覆盖率角标、缺数据文案、证据链接只实现一次。
// 纯渲染、零 hooks;交互只有普通 <a>(下钻由使用者的 attemptHref 决定去处)。

import type { ReactElement } from "react";
import type { AttemptRef, MetricCell } from "./data.ts";
import { MISSING_TEXT } from "./format.ts";

export function MetricCellView({
  cell,
  attemptHref,
}: {
  cell: MetricCell;
  attemptHref?: (ref: AttemptRef) => string;
}): ReactElement {
  // 全 null(没有任何有效样本)→ 缺数据文案,绝不画 0;total 仍如实入 title
  if (cell.value === null) {
    return (
      <span className="nre-cell nre-cell-missing">
        <span className="nre-missing" title={`0/${cell.total} attempts measurable`}>
          {MISSING_TEXT}
        </span>
      </span>
    );
  }
  return (
    <span className="nre-cell">
      <span className="nre-value" title={`${cell.samples}/${cell.total} attempts measured`}>
        {cell.display}
      </span>
      {/* samples < total:有 attempt 测不了这个指标,覆盖率角标如实标出 */}
      {cell.samples < cell.total && (
        <sup className="nre-coverage" title={`coverage ${cell.samples}/${cell.total}: this metric is null for the remaining attempts`}>
          {cell.samples}/{cell.total}
        </sup>
      )}
      {/* refs + attemptHref:格子可点,「给我看那次 attempt」就在手边 */}
      {attemptHref && cell.refs && cell.refs.length > 0 && (
        <span className="nre-refs">
          {cell.refs.map((ref, i) => (
            <a key={`${ref.run}:${ref.result}`} className="nre-ref" href={attemptHref(ref)}>
              #{i + 1}
            </a>
          ))}
        </span>
      )}
    </span>
  );
}
