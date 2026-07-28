// AttemptSummary:恒非空的身份/verdict/时间/成本卡(docs/feature/reports/components/attempt-detail/README.md)。

import type { ReactElement } from "react";
import type { AttemptSummaryData } from "../../model/types.ts";
import { DEFAULT_REPORT_LOCALE, localeText, type ReportLocale } from "../../model/locale.ts";
import { formatPoints } from "../../model/format.ts";
import { cx } from "../shared.ts";

const CAPABILITY_LABEL: globalThis.Record<keyof AttemptSummaryData["capabilities"], string> = {
  source: "source",
  execution: "execution",
  timing: "timing",
  diff: "diff",
};

export function AttemptSummary({
  data,
  locale = DEFAULT_REPORT_LOCALE,
  className,
}: {
  data: AttemptSummaryData;
  locale?: ReportLocale;
  className?: string;
}): ReactElement {
  const caps = (Object.keys(data.capabilities) as (keyof AttemptSummaryData["capabilities"])[]).filter(
    (k) => data.capabilities[k],
  );
  return (
    <div className={cx("nre", "nre-attempt-summary", className)}>
      <div className="nre-attempt-summary-head">
        <span className={`nre-verdict-pill nre-verdict-${data.verdict}`}>{localeText(locale, `verdict.${data.verdict}`)}</span>
        <span className="nre-attempt-summary-locator">{data.locator}</span>
      </div>
      <dl className="nre-attempt-summary-kpis">
        <div>
          <dt>Experiment</dt>
          <dd>{data.identity.experimentId}</dd>
        </div>
        <div>
          <dt>Eval</dt>
          <dd>{data.identity.evalId}</dd>
        </div>
        <div>
          <dt>Attempt</dt>
          <dd>{data.identity.attempt + 1}</dd>
        </div>
        {/* 计分制 attempt 本轮挣分:详情页总分位的唯一出现处,其它区块不重复这个总数
            (docs/feature/assertions/library/display.md「计分制」)。通过制 eval 恒省略。 */}
        {data.totalScore !== undefined ? (
          <div>
            <dt>Score</dt>
            <dd>{formatPoints(data.totalScore)}</dd>
          </div>
        ) : null}
        {data.startedAt ? (
          <div>
            <dt>Started</dt>
            <dd>{data.startedAt}</dd>
          </div>
        ) : null}
        <div>
          <dt>Duration</dt>
          <dd>{formatDurationMs(data.durationMs)}</dd>
        </div>
        {data.costUSD !== null ? (
          <div>
            <dt>Cost</dt>
            <dd>${data.costUSD.toFixed(4)}</dd>
          </div>
        ) : null}
      </dl>
      {caps.length > 0 ? (
        <p className="nre-attempt-summary-caps">{caps.map((k) => CAPABILITY_LABEL[k]).join(" · ")}</p>
      ) : null}
    </div>
  );
}

function formatDurationMs(ms: number): string {
  if (ms >= 60_000) return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}
