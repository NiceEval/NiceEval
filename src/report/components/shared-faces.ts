// 跨组件族共用的 text 面辅助:MetricCell / VerdictTally 的文本渲染在 summaries、
// entity-lists、metric-views 三族的 text 面里都要用到,住在这里而不是任一族自己的
// faces.ts,避免三份重复实现分叉(与 ../cell.tsx 的 MetricCellView 是同一份契约的
// text/web 两面)。

import type { MetricCell, VerdictTally } from "../model/types.ts";
import { localeText, resolveLocalizedText, type ReportLocale } from "../model/locale.ts";

export const MISSING_MARK = "—";

/** 缺数据文案随 locale(en = "no data")。 */
export function missingText(locale: ReportLocale): string {
  return localeText(locale, "cell.missing");
}

/** 格子的文本形态:缺数据 —,覆盖不全带 samples/total 角标;display 按 locale 解析。 */
export function cellText(cell: MetricCell, locale: ReportLocale): string {
  if (cell.value === null) return MISSING_MARK;
  const display = resolveLocalizedText(cell.display, locale);
  return cell.samples < cell.total ? `${display} ${cell.samples}/${cell.total}` : display;
}

/** verdict 计票的紧凑文案("3 passed · 1 failed"):非零判定逐个列,全部为零如实 —。 */
export function verdictTallyText(tally: VerdictTally, locale: ReportLocale): string {
  const parts: string[] = [];
  for (const kind of ["passed", "failed", "errored", "unreadable"] as const) {
    if (tally[kind] > 0) parts.push(`${tally[kind]} ${localeText(locale, `verdict.${kind}`)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : MISSING_MARK;
}
