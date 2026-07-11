// CaseList:失败案例清单——报告回答完「多少」,这里回答「为什么」。
// 逐条列出失败断言 / error 摘要 / judge 评语(evidence),每条带 attemptHref 下钻;
// truncated 如实报「还有 n 条没列」。长文本收进 <details>,零 JS 也能展开。

import type { ReactElement } from "react";
import type { AttemptRef, CaseListData } from "../types.ts";
import { colorClassForKey } from "./colors.ts";
import { cx, formatDurationMs, formatUSD } from "./format.ts";

export function CaseList({
  data,
  attemptHref,
  className,
}: {
  data: CaseListData;
  attemptHref?: (ref: AttemptRef) => string;
  className?: string;
}): ReactElement {
  return (
    <section className={cx("nre", "nre-case-list", className)}>
      {data.rows.length === 0 && <p className="nre-case-empty">No failed or errored attempts</p>}
      <ol className="nre-cases">
        {data.rows.map((row) => (
          <li key={`${row.ref.run}:${row.ref.result}`} className={cx("nre-case", `nre-case-${row.verdict}`)}>
            <div className="nre-case-head">
              <span className={cx("nre-case-verdict", `nre-verdict-${row.verdict}`)}>{row.verdict}</span>
              <span className="nre-case-eval">{row.eval}</span>
              {/* agent 键:稳定散列上色,与其它块同键同色 */}
              <span className={cx("nre-case-agent", "nre-key", colorClassForKey(row.agent))}>{row.agent}</span>
              <span className="nre-case-experiment">{row.experimentId}</span>
              <span className="nre-case-duration">{formatDurationMs(row.durationMs)}</span>
              {row.costUSD !== undefined && <span className="nre-case-cost">{formatUSD(row.costUSD)}</span>}
              {attemptHref && (
                <a className="nre-case-link" href={attemptHref(row.ref)}>
                  view attempt
                </a>
              )}
            </div>

            {/* errored 的错误摘要(计算侧已过 redact) */}
            {row.error && <p className="nre-case-error">{row.error}</p>}

            {row.failedAssertions.length > 0 && (
              <ul className="nre-assertions">
                {row.failedAssertions.map((assertion, j) => (
                  <li key={j} className="nre-assertion">
                    <span className="nre-assertion-name">{assertion.name}</span>
                    <span className="nre-assertion-score">score {assertion.score}</span>
                    {/* detail / evidence 可能很长:<details> 收起,不 hydrate 也能展开 */}
                    {(assertion.detail || assertion.evidence) && (
                      <details className="nre-assertion-more">
                        <summary>details</summary>
                        {assertion.detail && <p className="nre-assertion-detail">{assertion.detail}</p>}
                        {assertion.evidence && (
                          <blockquote className="nre-assertion-evidence">{assertion.evidence}</blockquote>
                        )}
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {/* limit 之外还有几条,如实报,不静默截断 */}
      {data.truncated > 0 && <p className="nre-truncated">and {data.truncated} more not shown</p>}
    </section>
  );
}
