// unit 驱动的内置格式化(docs/feature/reports/library.md「指标」):
//   "%" → 87%    "ms" → 1.2s    "$" → $0.31    其余 → 1.2k 缩写(带 unit 后缀)
// metric.display 可整体覆盖;这里只负责默认。

import type { AssertionResult, Verdict } from "../types.ts";

/** 一位小数、去掉无意义的 ".0" 尾巴。 */
function trimmed(n: number): string {
  const s = n.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** 1.2k / 3.4M / 5.6B 式缩写(输入为非负数)。 */
function abbreviate(abs: number): string {
  if (abs >= 1e9) return `${trimmed(abs / 1e9)}B`;
  if (abs >= 1e6) return `${trimmed(abs / 1e6)}M`;
  if (abs >= 1e3) return `${trimmed(abs / 1e3)}k`;
  return Number.isInteger(abs) ? String(abs) : trimmed(abs);
}

function formatDuration(absMs: number): string {
  if (absMs < 1000) return `${Math.round(absMs)}ms`;
  if (absMs < 60_000) return `${trimmed(absMs / 1000)}s`;
  const totalSeconds = Math.round(absMs / 1000);
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}

function formatDollars(abs: number): string {
  if (abs >= 1000) return abbreviate(abs);
  if (abs >= 0.01 || abs === 0) return abs.toFixed(2);
  // 小额成本保留有效位,不四舍成 "$0.00" 假零
  return abs.toFixed(4);
}

export function formatMetricValue(value: number, unit?: string): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (unit === "%") return `${sign}${trimmed(Math.round(abs * 1000) / 10)}%`;
  if (unit === "ms") return sign + formatDuration(abs);
  if (unit === "$") return `${sign}$${formatDollars(abs)}`;
  const n = abbreviate(abs);
  return unit ? `${sign}${n} ${unit}` : `${sign}${n}`;
}

/** 无单位纯数字(scoreboard 总分等):一位小数,去尾零。 */
export function formatPlainNumber(value: number): string {
  const sign = value < 0 ? "-" : "";
  return sign + trimmed(Math.round(Math.abs(value) * 10) / 10);
}

// ── 以下是两个渲染面共用的展示格式化:MetricCell 一律自带 display(格式化发生在
//    计算侧),渲染面不重算;这里只服务 OverviewData 这类携带裸数字的字段。──

/** 全 null / 无样本的统一文案。绝不画 0(docs/feature/reports/architecture.md「指标聚合不变量」)。 */
export const MISSING_TEXT = "no data";

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

// ── 实体列表(ExperimentList / EvalList / AttemptList)共用的判定符 ──

/** passed / failed / errored / skipped 的判定符。 */
export function verdictMark(verdict: Verdict): string {
  switch (verdict) {
    case "passed":
      return "✓";
    case "failed":
      return "✗";
    case "errored":
      return "!";
    case "skipped":
      return "–";
  }
}

/**
 * 一个 AttemptListItem 的失败原因摘要,按优先级取第一个在场的:结构化 `error` 的一层摘要
 * (`error.message`,cause/stack 属于下钻详情不进摘要)→ 未通过的 gate 断言
 * (原始声明顺序,`name`,detail 在场则 `"name: detail"`,多条用「, 」连接)→ 缺席。与
 * compute.ts 的 `reasonFor(EvalResult)` 同一口径,只是输入换成瘦身后的 AttemptListItem——
 * 没有 `skipReason` 字段(AttemptListItem 不携带),skipped 的 attempt 因此没有原因摘要,
 * 这与它们本来就不该出现在「为什么失败」列表里的事实一致。EvalList / ExperimentList 的
 * 逐 attempt 徽标行用它给每个 attempt 自己的原因(而不是复用整道题的代表原因)。
 */
export function attemptItemReason(item: {
  error?: { message: string };
  assertions: AssertionResult[];
}): string | undefined {
  if (item.error !== undefined) return item.error.message;
  const gates = item.assertions.filter((a) => a.outcome === "failed" && a.severity === "gate");
  if (gates.length === 0) return undefined;
  return gates.map((a) => (a.detail ? `${a.name}: ${a.detail}` : a.name)).join(", ");
}
