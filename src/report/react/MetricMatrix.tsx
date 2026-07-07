// MetricMatrix:行 × 列 × 单指标(如 eval × agent × passRate)。
// cells 是稀疏的——没有样本的格子在数据里不出现,这里就空着,不补 0;
// 行/列顺序取 cells 里的首次出现顺序(排序是数据侧的事)。
// cell.refs + attemptHref:「哪道题谁挂了」之后的下一步「给我看那次 attempt」
// 是格子里的普通 <a>,不 hydrate 也能点。

import type { ReactElement } from "react";
import type { AttemptRef, MatrixData } from "./data.ts";
import { MetricCellView } from "./cell.tsx";
import { colorClassForKey } from "./colors.ts";
import { cx } from "./format.ts";

export function MetricMatrix({
  data,
  attemptHref,
  className,
}: {
  data: MatrixData;
  attemptHref?: (ref: AttemptRef) => string;
  className?: string;
}): ReactElement {
  // 稀疏 cells → 首次出现顺序的行/列键 + 查找表;组件只整理形状,不碰数值
  const rowKeys: string[] = [];
  const columnKeys: string[] = [];
  // 键用 \u0000 拼接:行/列键都是用户可见 id,普通分隔符可能撞键
  const byPosition = new Map<string, MatrixData["cells"][number]["cell"]>();
  for (const entry of data.cells) {
    if (!rowKeys.includes(entry.row)) rowKeys.push(entry.row);
    if (!columnKeys.includes(entry.column)) columnKeys.push(entry.column);
    byPosition.set(`${entry.row}\u0000${entry.column}`, entry.cell);
  }

  return (
    <table className={cx("nre", "nre-metric-matrix", className)}>
      <caption className="nre-matrix-caption">
        {data.metric.label}
        {data.metric.unit && <span className="nre-unit">({data.metric.unit})</span>}
        <span className="nre-matrix-axes">
          {data.rows} × {data.columns}
        </span>
      </caption>
      <thead>
        <tr>
          <th scope="col" className="nre-dimension">
            {data.rows}
          </th>
          {columnKeys.map((column) => (
            // 列键 = 维度键(如 agent):稳定散列上色,与 scatter 的线、DeltaTable 的行同色
            <th scope="col" key={column} className={cx("nre-col-key", "nre-key", colorClassForKey(column))}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rowKeys.map((row) => (
          <tr key={row}>
            <th scope="row" className="nre-row-key">
              {row}
            </th>
            {columnKeys.map((column) => {
              const cell = byPosition.get(`${row}\u0000${column}`);
              return (
                <td key={column} className={cx("nre-td", !cell && "nre-td-empty")}>
                  {/* 稀疏格子:没有样本就空着(数据里不存在),不是 0 也不是缺数据文案 */}
                  {cell ? <MetricCellView cell={cell} attemptHref={attemptHref} /> : null}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
