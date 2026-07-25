// StabilityMatrix:历史全执行的稳定性矩阵。行 = eval,列 = by 维度取值,格是该组合全部历史
// 执行(跨快照按身份键去重、不设可比性门槛)的判定计数——回答「这道题历史上稳不稳」,不是
// 现刻水位下「现在算不算过」(docs/feature/reports/components/tables.md「StabilityMatrix」)。
// 稀疏格子:没有样本的格子不出现,不编三个 0 冒充跑过。

import type { ReactElement } from "react";
import type { StabilityMatrixCell, StabilityMatrixData } from "../../model/types.ts";
import type { AttemptLocator } from "../../../results/locator.ts";
import { DEFAULT_REPORT_LOCALE, localeText, type ReportLocale } from "../../model/locale.ts";
import { colorClassForKey } from "../../assets/colors.ts";
import { cx } from "../shared.ts";

function CellCounts({ cell }: { cell: StabilityMatrixCell }): ReactElement {
  return (
    <span className="nre-stability-counts">
      <span className="nre-stability-passed">✓{cell.passed}</span>
      <span className="nre-stability-failed">✗{cell.failed}</span>
      <span className="nre-stability-errored">!{cell.errored}</span>
    </span>
  );
}

export function StabilityMatrix({
  data,
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  data: StabilityMatrixData;
  /** declared for API parity with the DeltaTable-family props; StabilityMatrixCell carries no
   *  per-cell locator to link to (see docs — 「要看某一格的逐次执行...下钻 --history」). */
  attemptHref?: (locator: AttemptLocator) => string;
  className?: string;
  locale?: ReportLocale;
}): ReactElement | null {
  if (data.rows.length === 0) return null;
  const byPosition = new Map<string, StabilityMatrixCell>();
  for (const entry of data.cells) byPosition.set(JSON.stringify([entry.row, entry.column]), entry.cell);

  return (
    <table className={cx("nre", "nre-stability-matrix", className)}>
      <thead>
        <tr>
          <th scope="col" className="nre-dimension">
            {localeText(locale, "table.eval")}
          </th>
          {data.columns.map((column) => (
            <th scope="col" key={column} className={cx("nre-col-key", "nre-key", colorClassForKey(column))}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row) => (
          <tr key={row.evalId}>
            <th scope="row" className="nre-row-key">
              {row.evalId}
              {row.neverPassed && <span className="nre-stability-never-passed">{localeText(locale, "stability.neverPassed")}</span>}
            </th>
            {data.columns.map((column) => {
              const cell = byPosition.get(JSON.stringify([row.evalId, column]));
              return (
                <td key={column} className={cx("nre-td", !cell && "nre-td-empty")}>
                  {cell ? <CellCounts cell={cell} /> : null}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="nre-stability-totals">
          <th scope="row">{localeText(locale, "delta.totalsRow")}</th>
          {data.columns.map((column) => {
            const total = data.totals[column];
            return (
              <td key={column} className="nre-td">
                {total ? <CellCounts cell={total} /> : null}
              </td>
            );
          })}
        </tr>
      </tfoot>
    </table>
  );
}
