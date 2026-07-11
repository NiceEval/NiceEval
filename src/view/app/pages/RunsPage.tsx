import { useState } from "react";
import type { RowRun, T } from "../shared.ts";
import { verdictClass, verdictLabel } from "../lib/verdict.ts";
import { formatCost, formatDateTime, formatDuration, formatTokens, totalTokens } from "../lib/format.ts";

/** 全部历史 attempt 打平成一张表;列表在 App 里由 flattenAttempts(全部快照,已跨快照去重)算好。 */
export function RunsView({ attempts, t }: { attempts: RowRun[]; t: T }) {
  const [query, setQuery] = useState("");
  const allRuns = attempts;
  const filtered = allRuns.filter((r: RowRun) => {
    const q = query.trim().toLowerCase();
    return !q || `${r.id} ${r.rowLabel} ${r.rowAgent} ${r.rowModel || ""}`.toLowerCase().includes(q);
  });
  return (
    <section id="tab-runs">
      <div className="section-head">
        <h2>{t("section.individualRuns")}</h2>
        <div className="controls">
          <input
            className="search"
            type="search"
            placeholder={t("search.runs")}
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      {!allRuns.length ? (
        <div className="empty">{t("empty.individualRuns")}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("table.evalId")}</th>
                <th>{t("table.experiment")}</th>
                <th>{t("table.verdict")}</th>
                <th>{t("table.agent")}</th>
                <th>{t("table.model")}</th>
                <th>{t("metric.duration")}</th>
                <th>{t("table.tokens")}</th>
                <th>{t("table.estCost")}</th>
                <th>{t("table.ranAt")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length ? (
                filtered.map((r: RowRun) => {
                  const verdict = r.verdict;
                  return (
                    <tr key={`${r.id}-${r.rowLabel}-${r.attempt}`}>
                      <td>
                        <span className="name">{r.id}</span>
                      </td>
                      <td>{r.rowLabel}</td>
                      <td className={verdictClass(verdict)}>{verdictLabel(verdict, t)}</td>
                      <td>{r.rowAgent}</td>
                      <td>{r.rowModel || t("config.default")}</td>
                      <td className="num">{formatDuration(r.durationMs)}</td>
                      <td className="num">{formatTokens(totalTokens(r.usage))}</td>
                      <td className="num">{formatCost(r.estimatedCostUSD)}</td>
                      <td className="num">{r.startedAt ? formatDateTime(r.startedAt) : "-"}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", color: "var(--muted)" }}>
                    {t("empty.runsFilter")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
