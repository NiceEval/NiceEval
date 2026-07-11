import type { T } from "../shared.ts";
import type { ViewResult, ViewRow } from "../types.ts";
import { evalPassRate, groupByEval } from "../lib/verdict.ts";
import { formatCost, formatDateTime, formatPercent } from "../lib/format.ts";

export function GroupSelector({
  groupMap,
  selectedGroup,
  onSelect,
  t,
}: {
  groupMap: Map<string, ViewRow[]>;
  selectedGroup: string | null;
  onSelect: (group: string) => void;
  t: T;
}) {
  if (!groupMap.size) return <div id="group-selector" className="group-selector" />;
  return (
    <div id="group-selector" className="group-selector">
      {[...groupMap.keys()].sort().map((group) => {
        const groupRows = groupMap.get(group) ?? [];
        const allResults = groupRows.flatMap((r: ViewRow) => r.results ?? []);
        const evalGroups = groupByEval(allResults); // 卡片计票按 eval,不按 attempt
        const failed = evalGroups.filter((g) => g.verdict === "failed").length;
        const errored = evalGroups.filter((g) => g.verdict === "errored").length;
        const passRate = evalPassRate(allResults);
        const tone = passRate >= 0.8 ? "good" : passRate >= 0.5 ? "warn" : "bad";
        const totalCost = groupRows.reduce((s: number, r: ViewRow) => s + (r.totalCostUSD || 0), 0);
        const lastRun = groupRows
          .map((r: ViewRow) => r.lastRunAt)
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1);
        const selected = selectedGroup === group;
        return (
          <div
            key={group}
            className={`group-card${selected ? " is-selected" : ""}`}
            tabIndex={0}
            role="button"
            onClick={() => onSelect(group)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(group);
              }
            }}
          >
            <div className="group-card-name">{group}</div>
            <div className={`group-card-rate ${tone}`}>{formatPercent(passRate)}</div>
            <div className="group-card-meta">
              {groupRows.length} {groupRows.length === 1 ? t("detail.evalResult") : t("detail.evalResults")} · {failed} {t("verdict.failed")}
              {errored ? ` · ${errored} ${t("verdict.errored")}` : ""} · {formatCost(totalCost)}
            </div>
            {lastRun ? <div className="group-card-time">{formatDateTime(lastRun)}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
