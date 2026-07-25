// DeltaTable:对照矩阵。每行一道 eval,每组列一个条件(首个是基准),尾部对基准的 Δ 列组;
// 通过制显示 verdict、计分制在同一位置显示挣分,tokens / 成本恒显示;翻转标记 ⇄ 只在该行各
// 条件判定不一致时出现;历史执行叠加 ↩ 标注(docs/feature/reports/components/tables/delta-table.md)。任一侧缺数据时对应分量各自显示缺,不硬算成 0。

import type { ReactElement } from "react";
import type { DeltaData } from "../../model/types.ts";
import type { AttemptLocator } from "../../../results/locator.ts";
import { DEFAULT_REPORT_LOCALE, localeText, type ReportLocale } from "../../model/locale.ts";
import { formatMetricValue, formatPoints, verdictMark } from "../../model/format.ts";
import { colorClassForKey } from "../../assets/colors.ts";
import { cx } from "../shared.ts";

type DeltaCell = DeltaData["rows"][number]["cells"][string];
type DeltaEntry = NonNullable<DeltaData["rows"][number]["delta"]>[string];

function signedMetricText(value: number, unit?: string): string {
  const text = formatMetricValue(Math.abs(value), unit);
  return value >= 0 ? `+${text}` : `-${text}`;
}

function ConditionCell({
  cell,
  attemptHref,
  locale,
}: {
  cell: DeltaCell | undefined;
  attemptHref?: (locator: AttemptLocator) => string;
  locale: ReportLocale;
}): ReactElement {
  if (!cell) return <span className="nre-missing">{localeText(locale, "cell.missing")}</span>;
  const primary =
    cell.scoring === "points"
      ? cell.totalScore !== undefined
        ? formatPoints(cell.totalScore)
        : localeText(locale, "cell.missing")
      : `${verdictMark(cell.verdict)} ${localeText(locale, `verdict.${cell.verdict}`)}`;
  const body = (
    <>
      <span className="nre-delta-verdict">{primary}</span>
      <span className="nre-delta-tokens">{cell.totalTokens !== undefined ? formatMetricValue(cell.totalTokens) : "—"}</span>
      <span className="nre-delta-cost">{cell.totalCostUSD !== undefined ? formatMetricValue(cell.totalCostUSD, "$") : "—"}</span>
      {cell.historical && <span className="nre-delta-historical">↩</span>}
    </>
  );
  if (attemptHref && cell.attempts.length > 0) {
    return (
      <a className="nre-delta-condition-link" href={attemptHref(cell.attempts[0]!)}>
        {body}
        {cell.attempts.length > 1 && <span className="nre-delta-count">×{cell.attempts.length}</span>}
      </a>
    );
  }
  return <span className="nre-delta-condition">{body}</span>;
}

function DeltaEntryCell({ entry, hasScore }: { entry: DeltaEntry | undefined; hasScore: boolean }): ReactElement {
  return (
    <span className={cx("nre-delta-side", "nre-delta-d")}>
      {hasScore && <span className="nre-delta-score">{entry?.score !== undefined ? signedMetricText(entry.score) : "—"}</span>}
      <span className="nre-delta-tokens">{entry?.tokens !== undefined ? signedMetricText(entry.tokens) : "—"}</span>
      <span className="nre-delta-cost">{entry?.costUSD !== undefined ? signedMetricText(entry.costUSD, "$") : "—"}</span>
    </span>
  );
}

export function DeltaTable({
  data,
  attemptHref,
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  data: DeltaData;
  attemptHref?: (locator: AttemptLocator) => string;
  className?: string;
  locale?: ReportLocale;
}): ReactElement {
  if (data.rows.length === 0) {
    return (
      <div className={cx("nre", "nre-delta-table-empty", className)}>
        <p className="nre-missing">{localeText(locale, "delta.empty", { experiments: data.experiments ?? 0 })}</p>
      </div>
    );
  }
  const baseline = data.conditions[0]!;
  const nonBaseline = data.conditions.slice(1);
  const hasScore = data.rows.some((row) => Object.values(row.cells).some((cell) => cell.scoring === "points"));

  return (
    <div className={cx("nre", "nre-delta-table", className)}>
      <table>
        <thead>
          <tr>
            <th scope="col" className="nre-dimension">
              {localeText(locale, "table.eval")}
            </th>
            {data.conditions.map((condition) => (
              <th scope="col" key={condition} className={cx("nre-key", colorClassForKey(condition))}>
                {condition}
              </th>
            ))}
            {nonBaseline.map((condition) => (
              <th scope="col" key={`delta-${condition}`} className="nre-delta-header">
                Δ {condition}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.key} className={row.flipped ? "nre-delta-flipped" : undefined}>
              <th scope="row" className="nre-row-key">
                {row.key}
                {row.flipped && <span className="nre-delta-flip-mark">⇄</span>}
              </th>
              {data.conditions.map((condition) => (
                <td key={condition} className="nre-td">
                  <ConditionCell cell={row.cells[condition]} attemptHref={attemptHref} locale={locale} />
                </td>
              ))}
              {nonBaseline.map((condition) => (
                <td key={`delta-${condition}`} className="nre-td">
                  <DeltaEntryCell entry={row.delta?.[condition]} hasScore={hasScore} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="nre-delta-totals">
            <th scope="row">{localeText(locale, "delta.totalsRow")}</th>
            {data.conditions.map((condition) => {
              const totals = data.totals[condition];
              return (
                <td key={condition} className="nre-td">
                  {totals ? (
                    <>
                      {totals.passed !== undefined && totals.denominator !== undefined && (
                        <span className="nre-delta-verdict">
                          {totals.passed}/{totals.denominator} {localeText(locale, "verdict.passed")}
                        </span>
                      )}
                      {totals.totalScore !== undefined && <span className="nre-delta-verdict">{formatPoints(totals.totalScore)}</span>}
                      {totals.totalTokens !== undefined && (
                        <span className="nre-delta-tokens">{formatMetricValue(totals.totalTokens)}</span>
                      )}
                      {totals.totalCostUSD !== undefined && (
                        <span className="nre-delta-cost">{formatMetricValue(totals.totalCostUSD, "$")}</span>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              );
            })}
            {nonBaseline.map((condition) => (
              <td key={`delta-${condition}`} />
            ))}
          </tr>
        </tfoot>
      </table>
      {nonBaseline.some((condition) => {
        const pd = data.pairedDelta[condition];
        return pd && pd.commonEvalIds.length > 0;
      }) && (
        <ul className="nre-delta-paired">
          {nonBaseline.map((condition) => {
            const pd = data.pairedDelta[condition];
            if (!pd || pd.commonEvalIds.length === 0) return null;
            return (
              <li key={condition}>
                {localeText(locale, "delta.commonVsBaseline", { n: pd.commonEvalIds.length })} · {baseline} → {condition}:{" "}
                {pd.pass && (
                  <span>
                    {localeText(locale, "delta.passRate")} {signedMetricText(pd.pass.passRatePoints)}pt
                  </span>
                )}
                {pd.points && (
                  <span>
                    {" "}
                    {localeText(locale, "delta.totalScore")} {signedMetricText(pd.points.totalScore)}
                  </span>
                )}
                {pd.tokens !== undefined && <span> tokens {signedMetricText(pd.tokens)}</span>}
                {pd.costUSD !== undefined && (
                  <span>
                    {" "}
                    {localeText(locale, "delta.cost")} {signedMetricText(pd.costUSD, "$")}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
