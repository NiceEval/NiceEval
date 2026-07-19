// ExperimentList:实体列表的第一级。web 面是一行一个 experiment 的固定八列比较表
// (Experiment / Model / Agent / Avg. time / Pass rate / Tokens / Cost / Results),
// 每行用原生 <details> 展开到 Eval 与 Attempt locator。数据完全来自 experimentListData(),
// 组件不重算、不推断组边界。

import type { ReactElement } from "react";
import type { AttemptLocator } from "../../results/locator.ts";
import type { AttemptListItem, ExperimentListEvalRow, ExperimentListItem } from "../types.ts";
import { experimentDisplayName } from "../format.ts";
import { DEFAULT_REPORT_LOCALE, localeText, type ReportLocale } from "../locale.ts";
import { AttemptLocatorBadge, failureSummaryText } from "./AttemptList.tsx";
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
    .filter((verdict) => item.evalVerdicts[verdict] > 0)
    .map((verdict) => `${item.evalVerdicts[verdict]} ${localeText(locale, `verdict.${verdict}`)}`);
  return <span className="nre-experiment-pill">{parts.join(" · ") || "—"}</span>;
}

function ExperimentAttemptRow({
  attempt,
  last,
  attemptHref,
  locale,
}: {
  attempt: AttemptListItem;
  last: boolean;
  attemptHref?: (locator: AttemptLocator) => string;
  locale: ReportLocale;
}): ReactElement {
  const reason = failureSummaryText(attempt, locale);
  return (
    <li className={cx("nre-experiment-attempt-row", `nre-eval-${attempt.verdict}`)}>
      <span className="nre-attempt-branch" aria-hidden="true">{last ? "└─" : "├─"}</span>
      <span className="nre-eval-attempt-badges">
        <AttemptLocatorBadge item={attempt} attemptHref={attemptHref} />
      </span>
      <span className="nre-eval-attempt-metrics">
        {formatDurationMs(attempt.durationMs)}
        {attempt.costUSD !== null && <> · {formatUSD(attempt.costUSD)}</>}
      </span>
      {/* passed attempt 的 Result 是 —,不罗列通过的 assertions */}
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
  attemptHref?: (locator: AttemptLocator) => string;
  locale: ReportLocale;
}): ReactElement {
  const duration = row.durationMs.value === null ? localeText(locale, "cell.missing") : formatDurationMs(row.durationMs.value);
  const cost = row.costUSD.value === null ? localeText(locale, "cell.missing") : formatUSD(row.costUSD.value);
  return (
    <li className="nre-experiment-eval">
      {/* Eval 父行只显示折叠判定、Attempt 数与题级平均;失败原因只在 Attempt 子行 */}
      <div className={cx("nre-experiment-eval-header", `nre-eval-${row.verdict}`)}>
        <span className={cx("nre-eval-verdict", `nre-verdict-${row.verdict}`)}>{verdictMark(row.verdict)}</span>
        <span className="nre-eval-id">{row.evalId}</span>
        <span className="nre-eval-attempt-count">{localeText(locale, "overview.attemptsCount", { n: row.attempts.length })}</span>
        <span className="nre-eval-rollup">
          {localeText(locale, "entityList.average", { value: duration })}
          {" · "}
          {localeText(locale, "entityList.average", { value: cost })}
        </span>
      </div>
      <ul className="nre-experiment-attempts">
        {row.attempts.map((attempt, index) => (
          <ExperimentAttemptRow
            key={attempt.locator}
            attempt={attempt}
            last={index === row.attempts.length - 1}
            attemptHref={attemptHref}
            locale={locale}
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
        <b key={key}>{key}={typeof value === "string" ? value : JSON.stringify(value)}</b>
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
  attemptHref?: (locator: AttemptLocator) => string;
  locale: ReportLocale;
  relativeTo?: string;
}): ReactElement {
  return (
    <details className="nre-experiment-entry">
      <summary className="nre-experiment-summary">
        {/* relativeTo 只影响显示末段;完整 id 仍是排序 / 过滤 / 折叠的键,系列色跟随 agent */}
        <span className="nre-experiment-name" data-sort-value={item.experimentId}>
          <b className={cx("nre-experiment-id", "nre-key")}>
            {experimentDisplayName(item.experimentId, relativeTo)}
          </b>
          <small>
            {localeText(locale, "overview.evalsCount", { n: item.evals })}
            {item.attempts > item.evals ? ` · ${localeText(locale, "overview.attemptsCount", { n: item.attempts })}` : ""}
            {` · ${formatDate(item.lastRunAt, locale)}`}
          </small>
        </span>
        <span data-sort-value={item.model ?? ""}>{item.model ?? localeText(locale, "experimentList.defaultModel")}</span>
        <span data-sort-value={item.agent}>
          <span className={cx("nre-experiment-agent", "nre-key", colorClassForKey(item.agent))}>{item.agent}</span>
        </span>
        <span className="nre-num" data-sort-value={item.durationMs.value ?? ""}>
          <MetricCellView cell={item.durationMs} locale={locale} />
        </span>
        <span
          className={cx("nre-num", passRateTone(item.endToEndPassRate.value))}
          data-sort-value={item.endToEndPassRate.value ?? ""}
        >
          <MetricCellView cell={item.endToEndPassRate} locale={locale} />
        </span>
        <span className="nre-num" data-sort-value={item.tokens.value ?? ""}>
          <MetricCellView cell={item.tokens} locale={locale} />
        </span>
        <span className="nre-num" data-sort-value={item.costUSD.value ?? ""}>
          <MetricCellView cell={item.costUSD} locale={locale} />
        </span>
        <span data-sort-value={item.evalVerdicts.passed}><VerdictSummary item={item} locale={locale} /></span>
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
  data,
  attemptHref,
  filter = false,
  className,
  locale = DEFAULT_REPORT_LOCALE,
  relativeTo,
}: {
  data: readonly ExperimentListItem[];
  attemptHref?: (locator: AttemptLocator) => string;
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
    localeText(locale, "experimentList.cost"),
    localeText(locale, "experimentList.result"),
  ];
  const board = (
    <div className="nre-experiment-table">
      <div className="nre-experiment-head">
        {labels.map((label, index) => (
          <button
            type="button"
            data-nre-experiment-sort={index}
            className={cx(index >= 3 && index <= 6 && "nre-num-head", index === 4 && "nre-sort-desc")}
            key={label}
            title={index === 4 ? localeText(locale, "experimentList.passRateDescription") : undefined}
          >
            <span className="nre-sort-label">{label}</span>
            <span className="nre-sort-icon" aria-hidden="true" />
          </button>
        ))}
      </div>
      {data.length === 0 && <p className="nre-experiment-list-empty">{localeText(locale, "attemptList.empty")}</p>}
      {data.map((item) => (
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
