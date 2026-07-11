import React, { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { OpenModal, T } from "../shared.ts";
import type { Assertion, SortKey, SortState, ViewResult, ViewRow } from "../types.ts";
import { EvalGroup, failingAssertions, groupByEval, verdictClass, verdictLabel, verdictSummary, reasonFor, scoresSummary } from "../lib/verdict.ts";
import { CELL_KEYS, configChips } from "../lib/rows.ts";
import { formatClock, formatCost, formatDateTime, formatDuration, formatTokens, totalTokens } from "../lib/format.ts";
import { Kpi, SortHeader } from "./primitives.tsx";
import type { MetricCell } from "../types.ts";

/** 官方格子的渲染:display 已格式化;samples < total 时 title 如实报覆盖率(有 attempt 测不了这个指标)。 */
function CellValue({ cell }: { cell: MetricCell | undefined }) {
  if (!cell || cell.value === null) return <>—</>;
  const partial = cell.samples < cell.total;
  return <span title={partial ? `${cell.samples}/${cell.total} attempts measured` : undefined}>{cell.display}</span>;
}

export function ExperimentTable({
  rows,
  sort,
  setSortKey,
  openRows,
  toggleRow,
  openModal,
  t,
}: {
  rows: ViewRow[];
  sort: SortState;
  setSortKey: (key: SortKey) => void;
  openRows: Set<string>;
  toggleRow: (key: string) => void;
  openModal: OpenModal;
  t: T;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <SortHeader name={t("table.experiment")} sortKey="experiment" sort={sort} onSort={setSortKey} />
            <SortHeader name={t("table.model")} sortKey="model" sort={sort} onSort={setSortKey} />
            <SortHeader name={t("table.agent")} sortKey="agent" sort={sort} onSort={setSortKey} />
            <SortHeader name={t("table.avgDuration")} sortKey="duration" sort={sort} onSort={setSortKey} />
            <SortHeader name={t("table.successRate")} sortKey="passRate" sort={sort} onSort={setSortKey} />
            <SortHeader name={t("table.tokens")} sortKey="tokens" sort={sort} onSort={setSortKey} />
            <SortHeader name={t("table.estCost")} sortKey="cost" sort={sort} onSort={setSortKey} />
            <th>{t("table.verdicts")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row: ViewRow) => (
            <React.Fragment key={row.key}>
              <ExperimentRow row={row} open={openRows.has(row.key)} onToggle={() => toggleRow(row.key)} t={t} />
              {openRows.has(row.key) ? <ExperimentDetail row={row} openModal={openModal} t={t} /> : null}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExperimentRow({ row, open, onToggle, t }: { row: ViewRow; open: boolean; onToggle: () => void; t: T }) {
  const passRate = row.cells[CELL_KEYS.passRate]?.value ?? null;
  const tone = passRate === null ? "" : passRate >= 0.8 ? "good" : passRate >= 0.5 ? "warn" : "bad";
  return (
    <tr
      className={`main-row${open ? " is-open" : ""}`}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <td>
        <ChevronRight className="chev-icon" aria-hidden="true" />
        <span className="name">{row.label}</span>
        <div className="sub">
          {row.evals} {row.evals === 1 ? t("detail.evalResult") : t("detail.evalResults")}
          {row.runs > row.evals ? ` · ${row.runs} ${t("detail.runsUnit")}` : ""}
          {row.lastRunAt ? ` · ${formatDateTime(row.lastRunAt)}` : ""}
        </div>
      </td>
      <td>{row.model || t("config.default")}</td>
      <td>{row.agent}</td>
      {/* 官方 MetricTable.data 的格子:display 直接渲染,数字口径与 show 榜单同源。 */}
      <td className="num">
        <CellValue cell={row.cells[CELL_KEYS.duration]} />
      </td>
      <td className={`num ${tone}`}>
        <CellValue cell={row.cells[CELL_KEYS.passRate]} />
      </td>
      <td className="num">
        <CellValue cell={row.cells[CELL_KEYS.tokens]} />
      </td>
      <td className="num">
        <CellValue cell={row.cells[CELL_KEYS.cost]} />
      </td>
      <td>
        <span className="pill">{verdictSummary(row, t)}</span>
      </td>
    </tr>
  );
}

export function ExperimentDetail({ row, openModal, t }: { row: ViewRow; openModal: OpenModal; t: T }) {
  const totalDuration = (row.results ?? []).reduce((sum: number, r: ViewResult) => sum + (r.durationMs || 0), 0);
  const sampleResult =
    row.results?.find((r: ViewResult) => r.verdict === "errored") ||
    row.results?.find((r: ViewResult) => r.verdict === "failed") ||
    row.results?.[0] ||
    {};
  const evalGroups = groupByEval(row.results ?? []).sort((a, b) => a.id.localeCompare(b.id));
  return (
    <tr className="detail-row">
      <td className="detail-cell" colSpan={8}>
        <div className="detail">
          <div className="config-strip">
            {configChips(row, t).map(([label, value]) => (
              <span className="config-chip" key={label}>
                <span>{label}</span>
                <b>{value}</b>
              </span>
            ))}
          </div>
          <div className="detail-kpis">
            <Kpi label={t("detail.evals")} value={row.evals} />
            <Kpi label={t("detail.passed")} value={row.passed} className="good" />
            <Kpi label={t("detail.failed")} value={row.failed} className={row.failed ? "bad" : ""} />
            <Kpi label={t("detail.errored")} value={row.errored} className={row.errored ? "infra-err" : ""} />
            {row.runs > row.evals ? <Kpi label={t("detail.runs")} value={row.runs} /> : null}
            <Kpi label={t("detail.totalTime")} value={formatDuration(totalDuration)} />
            <Kpi label={t("detail.totalCost")} value={formatCost(row.totalCostUSD)} />
            <Kpi label={t("detail.ran")} value={formatDateTime(row.lastRunAt)} title={row.lastRunAt || ""} />
          </div>
          <h3>{t("detail.evaluationAttempts")}</h3>
          <div className="eval-list">
            <div className="eval-grid-head">
              <span>{t("detail.status")}</span>
              <span>{t("detail.eval")}</span>
              <span>{t("detail.reason")}</span>
              <span>{t("detail.time")}</span>
              <span>{t("table.tokens")}</span>
              <span>{t("table.estCost")}</span>
              <span>{t("detail.run")}</span>
            </div>
            {evalGroups.map((group) => (
              <EvalRow key={`${group.experimentId ?? ""}-${group.id}`} group={group} openModal={openModal} t={t} />
            ))}
          </div>
          <details className="raw-details">
            <summary>
              {t("detail.rawSample")} <span className="raw-note">{t("detail.rawNote")}</span>
            </summary>
            <pre>{JSON.stringify(sampleResult, null, 2)}</pre>
          </details>
        </div>
      </td>
    </tr>
  );
}

/**
 * 一个 eval 一行:多轮(runs>1)折叠成单行摘要,点开展开各轮 attempt;单轮直接就是那条 attempt。
 * Run 列显示 通过轮数 / 总轮数(如 0/3、2/3),让 earlyExit 重试和 flaky 一眼可见。
 */
export function EvalRow({ group, openModal, t }: { group: EvalGroup; openModal: OpenModal; t: T }) {
  const [open, setOpen] = useState(false);
  const n = group.attempts.length;

  if (n === 1) {
    return <Attempt result={group.attempts[0]!} totalRuns={1} openModal={openModal} t={t} />;
  }

  // 代表轮:取与 eval 判定相同的第一条,用它的原因/分数做折叠行摘要。
  const rep = group.attempts.find((a) => a.verdict === group.verdict) ?? group.attempts[0]!;
  const gates = failingAssertions(rep);
  const reason = reasonFor(rep, gates) || (group.verdict === "passed" ? scoresSummary(rep.assertions || []) : "");
  const totalDuration = group.attempts.reduce((s, a) => s + (a.durationMs || 0), 0);
  const totalTok = group.attempts.reduce((s, a) => s + totalTokens(a.usage), 0);
  const totalCost = group.attempts.reduce((s, a) => s + (a.estimatedCostUSD || 0), 0);
  const toggle = () => setOpen((v) => !v);

  return (
    <>
      <div
        className={`eval-item eval-item-clickable eval-group${open ? " is-open" : ""}`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
      >
        <span className="attempt-status">
          <span className={verdictClass(group.verdict)}>{verdictLabel(group.verdict, t)}</span>
        </span>
        <span className="eval-id">
          <ChevronRight className="chev-icon" aria-hidden="true" />
          {group.id}
        </span>
        <div className="assertions-cell">
          <span className="assertions" title={reason || undefined}>
            {reason || <span className="reason-empty">—</span>}
          </span>
        </div>
        <span className="num">{formatDuration(totalDuration)}</span>
        <span className="num">{formatTokens(totalTok)}</span>
        <span className="num">{formatCost(totalCost)}</span>
        <span className="num run-ratio" title={`${group.passedAttempts}/${n} ${t("detail.passed")}`}>
          {group.passedAttempts}/{n}
        </span>
      </div>
      {open ? (
        <div className="eval-attempts">
          {group.attempts.map((a) => (
            <Attempt key={`${a.id}-${a.attempt}`} result={a} totalRuns={n} openModal={openModal} t={t} />
          ))}
        </div>
      ) : null}
    </>
  );
}

export function Attempt({ result, totalRuns, openModal, t }: { result: ViewResult; totalRuns: number; openModal: OpenModal; t: T }) {
  const verdict = result.verdict;
  const gates = failingAssertions(result);
  const reason = reasonFor(result, gates);
  const allAssertions = result.assertions || [];
  const hasScores = allAssertions.some((a: Assertion) => a.score !== undefined && a.score !== null);
  const hasBody = result.hasEvents || result.hasTrace || hasScores;

  const inlineScores = !reason && verdict === "passed" ? scoresSummary(allAssertions) : "";
  const displayReason = reason || inlineScores;

  const handleOpen = () => openModal(result);

  const cells = (
    <>
      <span className="attempt-status">
        <span className={verdictClass(verdict)}>{verdictLabel(verdict, t)}</span>
      </span>
      <span className="eval-id">{result.id}</span>
      <div className="assertions-cell">
        <span
          className={`assertions${hasBody ? " assertions-link" : ""}`}
          title={displayReason || undefined}
          onClick={hasBody ? (e) => { e.stopPropagation(); handleOpen(); } : undefined}
        >
          {displayReason || <span className="reason-empty">—</span>}
        </span>
      </div>
      <span className="num">
        {formatDuration(result.durationMs)}
        {result.startedAt ? <small className="ran-at">{formatClock(result.startedAt)}</small> : null}
      </span>
      <span className="num">{formatTokens(totalTokens(result.usage))}</span>
      <span className="num">{formatCost(result.estimatedCostUSD)}</span>
      <span className="num" title={`attempt ${result.attempt + 1} of ${totalRuns}`}>
        #{result.attempt + 1}
      </span>
    </>
  );

  if (!hasBody) {
    return <div className="eval-item">{cells}</div>;
  }

  return (
    <div
      className="eval-item eval-item-clickable"
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleOpen(); }
      }}
    >
      {cells}
    </div>
  );
}
