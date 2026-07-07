// 展示层的小格式化。注意边界:MetricCell 一律自带 display(格式化发生在计算侧),
// 组件不重算;这里只服务 OverviewData 这类携带裸数字的字段(耗时、成本、比率),
// 以及 class 名拼接。缺数据的统一文案也钉在这里,保证各组件同词。

/** 全 null / 无样本的统一文案。绝不画 0(docs/reports.md「null ≠ 0」)。 */
export const MISSING_TEXT = "no data";

/** 拼 class 名:过滤空值,末尾接使用者透传的 className。 */
export function cx(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** 毫秒 → 人读耗时("850ms" / "1.2s" / "4m 20s" / "1h 4m")。 */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** 美元金额;小额保留更多位数,不四舍五入成 $0.00 的假零。 */
export function formatUSD(usd: number): string {
  if (usd === 0) return "$0";
  const digits = Math.abs(usd) >= 0.01 ? 2 : 4;
  return `$${usd.toFixed(digits)}`;
}

/** 0..1 的比率 → 整数百分比。 */
export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
