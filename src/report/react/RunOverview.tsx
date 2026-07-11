// RunOverview:页头 KPI 条——「这批数据是什么」。
// 数字下面标注数据来源(几个快照、何时跑的);warnings 有内容时直接显示在条内,
// 诚实不靠使用者记得渲染(docs/reports.md「第一档」行为清单)。

import type { ReactElement } from "react";
import type { OverviewData } from "../types.ts";
import { MISSING_TEXT, cx, formatDurationMs, formatPercent, formatUSD } from "./format.ts";

export function RunOverview({
  data,
  className,
}: {
  data: OverviewData;
  className?: string;
}): ReactElement {
  const { totals } = data;
  // 通过率口径与内置 passRate 指标一致:skipped → null 不进分母,errored/failed 计 0
  const judged = totals.passed + totals.failed + totals.errored;
  const passRate = judged > 0 ? formatPercent(totals.passed / judged) : null;

  return (
    <header className={cx("nre", "nre-overview", className)}>
      <dl className="nre-kpis">
        <div className="nre-kpi">
          <dt>Snapshots</dt>
          <dd>{data.snapshots.length}</dd>
        </div>
        <div className="nre-kpi">
          <dt>Evals</dt>
          <dd>{totals.evals}</dd>
        </div>
        <div className="nre-kpi">
          <dt>attempts</dt>
          <dd>{totals.attempts}</dd>
        </div>
        <div className="nre-kpi">
          <dt>Pass rate</dt>
          <dd>{passRate ?? <span className="nre-missing">{MISSING_TEXT}</span>}</dd>
        </div>
        <div className="nre-kpi">
          <dt>Total cost</dt>
          {/* costUSD 全缺 = null:显示缺数据,不编 $0 */}
          <dd>
            {totals.costUSD === null ? (
              <span className="nre-missing">{MISSING_TEXT}</span>
            ) : (
              formatUSD(totals.costUSD)
            )}
          </dd>
        </div>
        <div className="nre-kpi">
          <dt>Total duration</dt>
          <dd>{formatDurationMs(totals.durationMs)}</dd>
        </div>
      </dl>

      <p className="nre-verdicts">
        <span className="nre-verdict nre-verdict-passed">passed {totals.passed}</span>
        <span className="nre-verdict nre-verdict-failed">failed {totals.failed}</span>
        <span className="nre-verdict nre-verdict-errored">errored {totals.errored}</span>
        <span className="nre-verdict nre-verdict-skipped">skipped {totals.skipped}</span>
      </p>

      {/* 数据来源:哪些快照、何时跑的——报告的数字都从这里来 */}
      <p className="nre-source">
        Source: {data.snapshots.length} snapshots
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
