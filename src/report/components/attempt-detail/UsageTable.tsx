// UsageTable:判定、轮数、工具调用数、token 拆分与成本摊成的用量明细。没有 usage 时零输出
// (docs/feature/reports/components/attempt-detail/usage-table.md#组装口径单源)。web 面与 text 面
// 单行摘要(usageTableText)是同一份 UsageTableData 的两种呈现,不重复组装口径。

import type { ReactElement } from "react";
import type { UsageTableData } from "../../model/types.ts";
import { cx } from "../shared.ts";

export function UsageTable({ data, className }: { data: UsageTableData | null; className?: string }): ReactElement | null {
  if (data === null) return null;
  const usage = data.usage;
  const rows: [string, string][] = [];
  if (data.turns !== undefined) rows.push(["turns", String(data.turns)]);
  if (data.toolCalls !== undefined) rows.push(["tool calls", String(data.toolCalls)]);
  // 桶恒互斥,inputTokens 就是未缓存输入;"uncached in" 标签只在 cache 拆分在场时用,
  // cache 桶缺席的数字不贴标注。
  if (usage?.inputTokens !== undefined) {
    rows.push([usage.cacheReadTokens !== undefined ? "uncached in" : "in", usage.inputTokens.toLocaleString()]);
  }
  if (usage?.cacheReadTokens !== undefined) rows.push(["cache read", usage.cacheReadTokens.toLocaleString()]);
  if (usage?.outputTokens !== undefined) rows.push(["out", usage.outputTokens.toLocaleString()]);
  // requests 只在协议真实提供时显示——协议不提供就整行省略,绝不凑一个 1。
  if (usage?.requests !== undefined) rows.push(["requests", String(usage.requests)]);
  if (data.estimatedCostUSD !== undefined) rows.push(["cost", `$${data.estimatedCostUSD.toFixed(4)}`]);
  return (
    <dl className={cx("nre", "nre-usage-table", className)}>
      {rows.map(([k, v]) => (
        <div key={k} className="nre-usage-table-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
