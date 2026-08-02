// 跨组件族共用的 text 面辅助:MetricValue / VerdictTally 的文本渲染。
// 与 ../cell.tsx 的 MetricCellView 是同一份契约的 text/web 两面。

import type { MetricValue } from "../model/calculation.ts";
import type { VerdictTally } from "../model/types.ts";
import { formatMetricValue } from "../model/format.ts";
import { localeText, type ReportLocale } from "../model/locale.ts";

export const MISSING_MARK = "—";

/** 格子的文本形态:渲染面按 unit/format 格式化;覆盖不全带 samples/total 角标。 */
export function cellText(cell: MetricValue, locale: ReportLocale): string {
  const display = formatMetricValue(cell.value, cell.unit, cell.format, locale);
  if (cell.value === null) return display;
  return cell.samples < cell.total ? `${display} ${cell.samples}/${cell.total}` : display;
}

/** verdict 计票的紧凑文案("3 passed · 1 failed"):非零判定逐个列,全部为零如实 —。 */
export function verdictTallyText(tally: VerdictTally, locale: ReportLocale): string {
  const parts: string[] = [];
  for (const kind of ["passed", "failed", "errored", "skipped"] as const) {
    if (tally[kind] > 0) parts.push(`${tally[kind]} ${localeText(locale, `verdict.${kind}`)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : MISSING_MARK;
}
