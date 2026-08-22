// server 与前端共用的数值格式化;两边展示口径(取整/单位切换阈值)必须一致,所以单独成模块。
// 保持环境无关:不 import node/browser API。日期格式化不在这里 —— 它按前端当前 locale 做,
// 留在 app/lib/format.ts(见 formatDateTime)。

export function formatPercent(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0%";
  return Math.round(value * 100) + "%";
}

export function formatDuration(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "0ms";
  if (ms >= 60_000) return (ms / 60_000).toFixed(1) + "m";
  if (ms >= 1000) return (ms / 1000).toFixed(2) + "s";
  return Math.round(ms) + "ms";
}

export function formatCost(value?: number): string {
  // 查不到价 / 没有 model 时上游传 undefined(见 o11y/cost.ts) —— 显示 "—" 而不是騙人的 $0,
  // 否则「真实但极小的花费」和「压根没算出成本」在界面上长得一模一样。
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1) return "$" + value.toFixed(2);
  if (value >= 0.001) return "$" + value.toFixed(3);
  // 便宜模型 + 小样本(如 tier1 示例)常见的真实成本,3 位小数会整个舍成 0.000,
  // 这里退到 2 位有效数字,保留"确实花了一点点钱"的信号。
  return "$" + value.toPrecision(2);
}
