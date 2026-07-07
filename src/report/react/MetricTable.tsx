// MetricTable:行维度 × 指标列。
// 行按传入顺序渲染——排序发生在计算侧(table() 的 sort 参数),组件不重排;
// 「点列头重排」是后续的渐进增强,不 hydrate 时以数据侧预排的顺序呈现即完整。
// 列头以箭头标注 better 方向;samples < total 的格子带覆盖率角标;
// 一组全 null 渲染成「缺数据」,绝不画 0(逻辑在 MetricCellView)。

import type { ReactElement } from "react";
import type { AttemptRef, TableData } from "./data.ts";
import { MetricCellView } from "./cell.tsx";
import { colorClassForKey } from "./colors.ts";
import { cx } from "./format.ts";

export function MetricTable({
  data,
  attemptHref,
  className,
}: {
  data: TableData;
  attemptHref?: (ref: AttemptRef) => string;
  className?: string;
}): ReactElement {
  return (
    <table className={cx("nre", "nre-metric-table", className)}>
      <thead>
        <tr>
          <th scope="col" className="nre-dimension">
            {data.dimension}
          </th>
          {data.columns.map((col) => (
            <th scope="col" key={col.key} className="nre-metric-col">
              {col.label}
              {col.unit && <span className="nre-unit">({col.unit})</span>}
              {/* better 方向提示:↑ 越高越好 / ↓ 越低越好 */}
              {col.better && (
                <span
                  className="nre-better"
                  title={col.better === "higher" ? "higher is better" : "lower is better"}
                >
                  {col.better === "higher" ? "↑" : "↓"}
                </span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row) => (
          <tr key={row.key}>
            {/* 行键 = 维度键(如 agent):稳定散列上色,跨块同键同色 */}
            <th scope="row" className={cx("nre-row-key", "nre-key", colorClassForKey(row.key))}>
              {row.key}
            </th>
            {data.columns.map((col) => {
              const cell = row.cells[col.key];
              return (
                <td key={col.key} className="nre-td">
                  {cell ? (
                    <MetricCellView cell={cell} attemptHref={attemptHref} />
                  ) : (
                    // 数据侧没给这个格子(理论上 table() 不会缺列)——按空处理,不编数
                    <span className="nre-empty" />
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
