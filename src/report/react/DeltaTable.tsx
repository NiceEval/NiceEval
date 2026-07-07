// DeltaTable:成对对比(B 相对 A)。每格三个值:A、B、Δ;
// Δ 的涨跌好坏由指标的 better 判定并配色(涨不一定是好——成本涨了是坏);
// 任一侧缺数据时 Δ 显示为缺,不硬算(数据侧已给 delta: null,这里只如实渲染)。

import type { ReactElement } from "react";
import type { DeltaData, MetricColumn } from "./data.ts";
import { MetricCellView } from "./cell.tsx";
import { colorClassForKey } from "./colors.ts";
import { MISSING_TEXT, cx } from "./format.ts";

/** Δ 的语义配色 class:好/坏由 better 方向判定,不看正负号本身。 */
function deltaToneClass(delta: number | null, better: MetricColumn["better"]): string {
  if (delta === null) return "nre-delta-missing";
  if (delta === 0) return "nre-delta-flat";
  if (!better) return "nre-delta-neutral"; // 指标没表态方向,只显示不评判
  const improved = better === "higher" ? delta > 0 : delta < 0;
  return improved ? "nre-delta-good" : "nre-delta-bad";
}

export function DeltaTable({
  data,
  className,
}: {
  data: DeltaData;
  className?: string;
}): ReactElement {
  return (
    <table className={cx("nre", "nre-delta-table", className)}>
      <thead>
        <tr>
          <th scope="col" className="nre-dimension">
            对比(A → B)
          </th>
          {data.columns.map((col) => (
            <th scope="col" key={col.key} className="nre-metric-col">
              {col.label}
              {col.unit && <span className="nre-unit">({col.unit})</span>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row) => (
          <tr key={row.key}>
            <th scope="row" className="nre-pair">
              {/* pair 的 label(如 agent 名):稳定散列上色,与 scatter 的线同色 */}
              <span className={cx("nre-row-key", "nre-key", colorClassForKey(row.key))}>{row.key}</span>
              <span className="nre-pair-ids">
                {row.a.experimentId} → {row.b.experimentId}
              </span>
            </th>
            {data.columns.map((col) => {
              const cell = row.cells[col.key];
              if (!cell) return <td key={col.key} className="nre-td-empty" />;
              return (
                <td key={col.key} className="nre-delta-cell">
                  {/* A/B 走统一的 MetricCellView:缺数据文案与覆盖率角标同一套 */}
                  <span className="nre-delta-side nre-delta-a">
                    <span className="nre-delta-tag">A</span>
                    <MetricCellView cell={cell.a} />
                  </span>
                  <span className="nre-delta-side nre-delta-b">
                    <span className="nre-delta-tag">B</span>
                    <MetricCellView cell={cell.b} />
                  </span>
                  <span className={cx("nre-delta-side", "nre-delta-d", deltaToneClass(cell.delta, col.better))}>
                    <span className="nre-delta-tag">Δ</span>
                    {/* 任一侧 null → delta null:显示缺,不硬算 */}
                    {cell.delta === null ? <span className="nre-missing">{MISSING_TEXT}</span> : cell.display}
                  </span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
