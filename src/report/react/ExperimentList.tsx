// ExperimentList:实体列表的第一级。web 面是一行一个 experiment 的固定列比较表；
// 每行用原生 <details> 展开到 Eval 与 Attempt locator。数据仍完全来自
// ExperimentList.data(),不恢复旧 ExperimentTable 的混合实体计算层。

import type { ReactElement } from "react";
import type { AttemptLocator } from "../../results/locator.ts";
import type { AttemptListItem, ExperimentListEvalRow, ExperimentListItem } from "../types.ts";
import { attemptItemReason, experimentDisplayName } from "../format.ts";
import { DEFAULT_REPORT_LOCALE, localeText, type ReportLocale } from "../locale.ts";
import { AttemptLocatorBadge } from "./AttemptList.tsx";
import { MetricCellView } from "./cell.tsx";
import { colorClassForKey } from "./colors.ts";
import { cx, formatDurationMs, formatUSD, verdictMark } from "./format.ts";

const verdictOrder = ["passed", "failed", "errored", "skipped"] as const;

function passRateTone(value: number | null): string | undefined {
  if (value === null) return undefined;
  if (value >= 0.8) return "nre-good";
  if (value >= 0.5) return "nre-warn";
  return "nre-bad";
}

function formatDate(value: string, locale: ReportLocale): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function VerdictSummary({ item, locale }: { item: ExperimentListItem; locale: ReportLocale }): ReactElement {
  const parts = verdictOrder
    .filter((verdict) => item.verdicts[verdict] > 0)
    .map((verdict) => `${item.verdicts[verdict]} ${localeText(locale, `verdict.${verdict}`)}`);
  return <span className="nre-experiment-pill">{parts.join(" / ") || "—"}</span>;
}

function ExperimentAttemptRow({
  attempt,
  last,
  attemptHref,
}: {
  attempt: AttemptListItem;
  last: boolean;
  attemptHref: (locator: AttemptLocator) => string;
}): ReactElement {
  const reason = attemptItemReason(attempt);
  return (
    <li className={cx("nre-experiment-attempt-row", `nre-eval-${attempt.verdict}`)}>
      <span className="nre-attempt-branch" aria-hidden="true">{last ? "└─" : "├─"}</span>
      <span className="nre-eval-attempt-badges">
        <AttemptLocatorBadge item={attempt} attemptHref={attemptHref} />
      </span>
      <span className="nre-eval-attempt-metrics">
        {formatDurationMs(attempt.durationMs)}
        {attempt.costUSD !== undefined && <> · {formatUSD(attempt.costUSD)}</>}
      </span>
      <span className="nre-eval-reason">{reason ?? "—"}</span>
    </li>
  );
}

function EvalAttempts({
  row,
  attemptHref,
  locale,
}: {
  row: ExperimentListEvalRow;
  attemptHref: (locator: AttemptLocator) => string;
  locale: ReportLocale;
}): ReactElement {
  return (
    <li className="nre-experiment-eval">
      <div className={cx("nre-experiment-eval-header", `nre-eval-${row.verdict}`)}>
        <span className={cx("nre-eval-verdict", `nre-verdict-${row.verdict}`)}>{verdictMark(row.verdict)}</span>
        <span className="nre-eval-id">{row.evalId}</span>
        <span className="nre-eval-attempt-count">{localeText(locale, "overview.attemptsCount", { n: row.attempts.length })}</span>
        <span className="nre-eval-summary">
          {row.verdict === "passed"
            ? [formatDurationMs(row.duration.value ?? 0), row.cost.value === null ? undefined : formatUSD(row.cost.value)]
                .filter((value): value is string => value !== undefined)
                .join(" · ")
            : row.reason}
        </span>
      </div>
      <ul className="nre-experiment-attempts">
        {row.attempts.map((attempt, index) => (
          <ExperimentAttemptRow
            key={attempt.locator}
            attempt={attempt}
            last={index === row.attempts.length - 1}
            attemptHref={attemptHref}
          />
        ))}
      </ul>
    </li>
  );
}

function Flags({ flags, locale }: { flags: Record<string, unknown> | undefined; locale: ReportLocale }): ReactElement | null {
  if (!flags || Object.keys(flags).length === 0) return null;
  return (
    <div className="nre-experiment-flags">
      <span>{localeText(locale, "experimentList.flags")}</span>
      {Object.entries(flags).map(([key, value]) => (
        <b key={key}>{key}={String(value)}</b>
      ))}
    </div>
  );
}

function ExperimentRow({
  item,
  attemptHref,
  locale,
  relativeTo,
}: {
  item: ExperimentListItem;
  attemptHref: (locator: AttemptLocator) => string;
  locale: ReportLocale;
  relativeTo?: string;
}): ReactElement {
  return (
    <details className="nre-experiment-entry">
      <summary className="nre-experiment-summary">
        <span className="nre-experiment-name" data-sort-value={item.experimentId}>
          <b className={cx("nre-experiment-id", "nre-key", colorClassForKey(item.experimentId))}>
            {experimentDisplayName(item.experimentId, relativeTo)}
          </b>
          <small>
            {localeText(locale, "overview.evalsCount", { n: item.evals })}
            {item.attempts > item.evals ? ` · ${localeText(locale, "overview.attemptsCount", { n: item.attempts })}` : ""}
            {` · ${formatDate(item.lastRunAt, locale)}`}
          </small>
        </span>
        <span data-sort-value={item.model ?? ""}>{item.model ?? localeText(locale, "experimentList.defaultModel")}</span>
        <span data-sort-value={item.agent}>{item.agent}</span>
        <span className="nre-num" data-sort-value={item.duration.value ?? ""}>
          <MetricCellView cell={item.duration} locale={locale} />
        </span>
        <span className={cx("nre-num", passRateTone(item.passRate.value))} data-sort-value={item.passRate.value ?? ""}>
          <MetricCellView cell={item.passRate} locale={locale} />
        </span>
        <span className="nre-num" data-sort-value={item.tokens.value ?? ""}>
          <MetricCellView cell={item.tokens} locale={locale} />
        </span>
        <span className="nre-num" data-sort-value={item.cost.value ?? ""}>
          <MetricCellView cell={item.cost} locale={locale} />
        </span>
        <span data-sort-value={item.verdicts.passed}><VerdictSummary item={item} locale={locale} /></span>
      </summary>
      <div className="nre-experiment-detail">
        <Flags flags={item.flags} locale={locale} />
        <ul className="nre-experiment-evals">
          {item.evalRows.map((row) => (
            <EvalAttempts key={row.evalId} row={row} attemptHref={attemptHref} locale={locale} />
          ))}
        </ul>
      </div>
    </details>
  );
}

export function ExperimentList({
  items,
  attemptHref,
  filter = false,
  className,
  locale = DEFAULT_REPORT_LOCALE,
  relativeTo,
}: {
  items: ExperimentListItem[];
  attemptHref: (locator: AttemptLocator) => string;
  filter?: boolean;
  className?: string;
  locale?: ReportLocale;
  relativeTo?: string;
}): ReactElement {
  const labels = [
    localeText(locale, "experimentList.experiment"),
    localeText(locale, "table.model"),
    localeText(locale, "table.agent"),
    localeText(locale, "experimentList.avgDuration"),
    localeText(locale, "experimentList.passRate"),
    localeText(locale, "experimentList.tokens"),
    localeText(locale, "experimentList.estimatedCost"),
    localeText(locale, "experimentList.result"),
  ];
  const board = (
    <div className="nre-experiment-table">
      <div className="nre-experiment-head">
        {labels.map((label, index) => (
          <button
            type="button"
            data-nre-experiment-sort={index}
            className={index === 4 ? "nre-sort-desc" : undefined}
            key={label}
          >
            {label}
          </button>
        ))}
      </div>
      {items.length === 0 && <p className="nre-experiment-list-empty">{localeText(locale, "attemptList.empty")}</p>}
      {items.map((item) => (
        <ExperimentRow key={item.experimentId} item={item} attemptHref={attemptHref} locale={locale} relativeTo={relativeTo} />
      ))}
    </div>
  );
  return (
    <div className={cx("nre", "nre-experiment-list", filter && "nre-experiment-table-wrap", className)}>
      {filter && (
        <input
          className="nre-filter"
          data-nre-experiment-filter=""
          type="search"
          placeholder={localeText(locale, "experimentList.filterPlaceholder")}
        />
      )}
      {board}
    </div>
  );
}
