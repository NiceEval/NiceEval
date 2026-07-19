// TraceWaterfall:执行时间瀑布的 web 面——每个 attempt 一行,静态渲染顶层 span 分解条
// (定位按 startOffsetMs / durationMs 百分比;失败 span 带失败标记),行链接 attempt 详情。
// trace 缺失的行照常出现并如实显示缺失;排序、缩放是渐进增强,静态 HTML 无 JS 完整可读
// (docs/feature/reports/library/site-components.md「TraceWaterfall」)。

import type { ReactElement } from "react";
import type { TraceWaterfallRow } from "../types.ts";
import type { AttemptLocator } from "../../results/locator.ts";
import { DEFAULT_REPORT_LOCALE, countText, localeText, type ReportLocale } from "../locale.ts";
import { cx, formatDurationMs } from "./format.ts";

function pct(part: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.min(100, Math.max(0, (part / total) * 100)).toFixed(2)}%`;
}

/**
 * 执行时间瀑布(纯 web 渲染面):嵌入自有 React 页面时配合 `traceWaterfallData()` 使用。
 * 只画被测 agent 的原始 span;runner 生命周期节点不在 data 里,组合视图归 attempt 详情。
 */
export function TraceWaterfall({
  data,
  attemptHref,
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  data: readonly TraceWaterfallRow[];
  attemptHref?: (locator: AttemptLocator) => string;
  className?: string;
  locale?: ReportLocale;
}): ReactElement {
  return (
    <section className={cx("nre", "nre-trace-waterfall", className)}>
      {data.length === 0 && <p className="nre-waterfall-empty">{localeText(locale, "traceWaterfall.empty")}</p>}
      <ul className="nre-waterfall">
        {data.map((row) => {
          const failedSpans = row.spans.filter((span) => span.failed).length;
          return (
            <li key={row.locator} className="nre-waterfall-row">
              <div className="nre-waterfall-head">
                {attemptHref ? (
                  <a className="nre-locator" href={attemptHref(row.locator)}>
                    {row.locator}
                  </a>
                ) : (
                  <span className="nre-locator">{row.locator}</span>
                )}
                <span className="nre-waterfall-eval">{row.evalId}</span>
                <span className="nre-waterfall-experiment">{row.experimentId}</span>
                {/* trace 缺失如实显示缺失,不猜值、不藏行 */}
                <span className="nre-waterfall-duration">
                  {row.durationMs === null ? localeText(locale, "traceWaterfall.noTrace") : formatDurationMs(row.durationMs)}
                </span>
                <span className="nre-waterfall-count">{countText(locale, "traceWaterfall.spans", row.spans.length)}</span>
                {failedSpans > 0 && (
                  <span className="nre-waterfall-failed">✗ {countText(locale, "traceWaterfall.failedSpans", failedSpans)}</span>
                )}
              </div>
              {row.durationMs !== null && row.spans.length > 0 && (
                <div className="nre-waterfall-track">
                  {row.spans.map((span, i) => (
                    <span
                      key={i}
                      className={cx("nre-waterfall-span", `nre-span-${span.kind}`, span.failed && "nre-span-failed")}
                      style={{
                        left: pct(span.startOffsetMs, row.durationMs!),
                        width: `max(${pct(span.durationMs, row.durationMs!)}, 0.5%)`,
                      }}
                      title={`${span.name} · ${formatDurationMs(span.durationMs)}${span.failed ? " · ✗" : ""}`}
                    />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
