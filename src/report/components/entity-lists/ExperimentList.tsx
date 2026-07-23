// ExperimentList:实体列表的第一级。web 面是一行一个 experiment 的固定列比较表
// (Experiment / Model / Agent / Avg. time / 主读数 / Tokens / Cost / Results);主读数列
// 按列表内题型构成选择——纯通过制是 Pass rate,纯计分制是 Total score,两型并存时两列并排
// (entity-lists.md「ExperimentList」)。每行用原生 <details> 展开到 Eval 与 Attempt locator。
// 数据完全来自 experimentListData(),组件不重算、不推断组边界。

import type { ReactElement } from "react";
import type { AttemptLocator } from "../../../results/locator.ts";
import type { AttemptListItem, ExperimentListEvalRow, ExperimentListItem } from "../../model/types.ts";
import { experimentListScoringComposition, shortestUniqueLabels } from "../../model/format.ts";
import { DEFAULT_REPORT_LOCALE, localeText, resolveLocalizedText, type ReportLocale } from "../../model/locale.ts";
import { AttemptLocatorBadge, EvalHistoricalMark, HistoricalMark, failureSummaryText } from "./AttemptList.tsx";
import { MetricCellView } from "../cell.tsx";
import { colorClassForKey } from "../../assets/colors.ts";
import { formatDurationMs, formatUSD, verdictMark } from "../../model/format.ts";
import { cx } from "../shared.ts";

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
  scoring,
  attemptHref,
  locale,
}: {
  attempt: AttemptListItem;
  last: boolean;
  /** 所属 experiment 的题型(定义期事实,单个 experiment 内由启动期强制同型)。 */
  scoring: "pass" | "points";
  attemptHref?: (locator: AttemptLocator) => string;
  locale: ReportLocale;
}): ReactElement {
  const reason = failureSummaryText(attempt, locale);
  return (
    <li className={cx("nre-experiment-attempt-row", `nre-eval-${attempt.verdict}`)}>
      <span className="nre-attempt-branch" aria-hidden="true">{last ? "└─" : "├─"}</span>
      <span className="nre-eval-attempt-badges">
        <AttemptLocatorBadge item={attempt} attemptHref={attemptHref} />
        <HistoricalMark item={attempt} locale={locale} />
      </span>
      <span className="nre-eval-attempt-metrics">
        {formatDurationMs(attempt.durationMs)}
        {attempt.costUSD !== null && <> · {formatUSD(attempt.costUSD)}</>}
        {/* 计分制:附这一轮挣的分;通过制没有这个读数,不摆占位 */}
        {scoring === "points" && (
          <>
            {" · "}
            {attempt.totalScore.value === null
              ? localeText(locale, "cell.missing")
              : resolveLocalizedText(attempt.totalScore.display, locale)}
          </>
        )}
      </span>
      {/* passed attempt 的 Result 是 —,不罗列通过的 assertions */}
      <span className="nre-eval-reason">{reason ?? "—"}</span>
    </li>
  );
}

function EvalAttempts({
  row,
  scoring,
  attemptHref,
  locale,
}: {
  row: ExperimentListEvalRow;
  /** 所属 experiment 的题型(定义期事实,单个 experiment 内由启动期强制同型)。 */
  scoring: "pass" | "points";
  attemptHref?: (locator: AttemptLocator) => string;
  locale: ReportLocale;
}): ReactElement {
  const duration = row.durationMs.value === null ? localeText(locale, "cell.missing") : formatDurationMs(row.durationMs.value);
  const cost = row.costUSD.value === null ? localeText(locale, "cell.missing") : formatUSD(row.costUSD.value);
  const score = row.totalScore.value === null ? localeText(locale, "cell.missing") : resolveLocalizedText(row.totalScore.display, locale);
  return (
    <li className="nre-experiment-eval">
      {/* Eval 父行只显示折叠判定、Attempt 数与题级平均;失败原因只在 Attempt 子行 */}
      <div className={cx("nre-experiment-eval-header", `nre-eval-${row.verdict}`)}>
        <span className={cx("nre-eval-verdict", `nre-verdict-${row.verdict}`)}>{verdictMark(row.verdict)}</span>
        <span className="nre-eval-id">{row.evalId}</span>
        <EvalHistoricalMark attempts={row.attempts} />
        <span className="nre-eval-attempt-count">{localeText(locale, "overview.attemptsCount", { n: row.attempts.length })}</span>
        <span className="nre-eval-rollup">
          {localeText(locale, "entityList.average", { value: duration })}
          {" · "}
          {localeText(locale, "entityList.average", { value: cost })}
          {/* 计分制:附这道题挣的分;通过制没有这个读数,不摆占位 */}
          {scoring === "points" && <> · {score}</>}
        </span>
      </div>
      <ul className="nre-experiment-attempts">
        {row.attempts.map((attempt, index) => (
          <ExperimentAttemptRow
            key={attempt.locator}
            attempt={attempt}
            last={index === row.attempts.length - 1}
            scoring={scoring}
            attemptHref={attemptHref}
            locale={locale}
          />
        ))}
      </ul>
    </li>
  );
}

/**
 * 覆盖缺口的占位行:状态列为 —,结果列为「当前配置下无结果」+ 可复制的补跑命令,无 attempt
 * 子行,不参与任何指标聚合——只把分母缺口摆进读者正在看的表里
 * (docs/feature/reports/library/entity-lists.md「ExperimentList」)。
 */
function MissingEvalRow({
  evalId,
  experimentId,
  locale,
}: {
  evalId: string;
  experimentId: string;
  locale: ReportLocale;
}): ReactElement {
  const command = `niceeval exp ${experimentId}`;
  return (
    <li className="nre-experiment-eval nre-experiment-eval-missing">
      <div className="nre-experiment-eval-header">
        <span className="nre-eval-verdict">—</span>
        <span className="nre-eval-id">{evalId}</span>
        <span className="nre-eval-rollup">
          {localeText(locale, "experimentList.noResultsForConfig")} · <code>{command}</code>
        </span>
      </div>
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
  label,
  composition,
  attemptHref,
  locale,
}: {
  item: ExperimentListItem;
  label: string;
  /** 整份列表的题型构成——决定主读数是 Pass rate、Total score,还是两列并存。 */
  composition: "pass" | "points" | "mixed";
  attemptHref?: (locator: AttemptLocator) => string;
  locale: ReportLocale;
}): ReactElement {
  const showPassRate = composition !== "points";
  const showTotalScore = composition !== "pass";
  return (
    <details className="nre-experiment-entry">
      <summary className="nre-experiment-summary">
        {/* label 是当前列表里的最短唯一后缀;完整 id 仍是排序 / 过滤 / 折叠的键,系列色跟随 agent */}
        <span className="nre-experiment-name" data-sort-value={item.experimentId}>
          <b className={cx("nre-experiment-id", "nre-key")}>{label}</b>
          <small>
            {item.missingEvalIds.length > 0
              ? localeText(locale, "overview.evalsCountPartial", {
                  covered: item.evals,
                  total: item.evals + item.missingEvalIds.length,
                })
              : localeText(locale, "overview.evalsCount", { n: item.evals })}
            {item.attempts > item.evals ? ` · ${localeText(locale, "overview.attemptsCount", { n: item.attempts })}` : ""}
            {item.historicalAttempts > 0
              ? ` · ${localeText(locale, "experimentList.historicalAttempts", { n: item.historicalAttempts, m: item.attempts })}`
              : ""}
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
        {showPassRate && (
          // 计分制行的通过率是可判定的真实数字,不是缺数据——mixed 列表里强制显示 — 并清空
          // 排序值,不让藏起来的数字驱动排序(entity-lists.md「ExperimentList」主读数列)。
          <span
            className={cx("nre-num", item.scoring !== "points" && passRateTone(item.endToEndPassRate.value))}
            data-sort-value={item.scoring === "points" ? "" : (item.endToEndPassRate.value ?? "")}
          >
            {item.scoring === "points" ? "—" : <MetricCellView cell={item.endToEndPassRate} locale={locale} />}
          </span>
        )}
        {showTotalScore && (
          // 通过制行的 totalScore 本就是 null cell,MetricCellView 的缺数据渲染已经够用,
          // 这个方向没有「藏起来的真实值」问题,不需要像上面那样强制。
          <span className="nre-num" data-sort-value={item.totalScore.value ?? ""}>
            <MetricCellView cell={item.totalScore} locale={locale} />
          </span>
        )}
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
            <EvalAttempts key={row.evalId} row={row} scoring={item.scoring} attemptHref={attemptHref} locale={locale} />
          ))}
          {item.missingEvalIds.map((evalId) => (
            <MissingEvalRow key={evalId} evalId={evalId} experimentId={item.experimentId} locale={locale} />
          ))}
        </ul>
      </div>
    </details>
  );
}

/** 表头一列的渲染信息:数字列靠右对齐,defaultSort 是这份 data 默认排序落在这列时的初始箭头方向。 */
interface ExperimentHeadColumn {
  label: string;
  numeric?: boolean;
  defaultSort?: "asc" | "desc";
  title?: string;
}

export function ExperimentList({
  data,
  attemptHref,
  filter = false,
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  data: readonly ExperimentListItem[];
  attemptHref?: (locator: AttemptLocator) => string;
  filter?: boolean;
  className?: string;
  locale?: ReportLocale;
}): ReactElement {
  const experimentLabels = shortestUniqueLabels(data.map((item) => item.experimentId));
  // 主读数列按列表内题型构成选择;web/text 共用同一份判据,不各自重新判断
  // (docs/feature/reports/library/entity-lists.md「ExperimentList」)。
  const composition = experimentListScoringComposition(data);
  const showPassRate = composition !== "points";
  const showTotalScore = composition !== "pass";
  const columns: ExperimentHeadColumn[] = [
    // mixed 时两种读数不能互相排名,默认排序退回 experiment id 字典序(升序)——这里是唯一
    // 显示初始排序箭头的列;pass/points 单读数时箭头显示在下面那一列,这列不显示。
    { label: localeText(locale, "experimentList.experiment"), defaultSort: composition === "mixed" ? "asc" : undefined },
    { label: localeText(locale, "table.model") },
    { label: localeText(locale, "table.agent") },
    { label: localeText(locale, "experimentList.avgDuration"), numeric: true },
  ];
  if (showPassRate) {
    columns.push({
      label: localeText(locale, "experimentList.passRate"),
      numeric: true,
      defaultSort: composition === "pass" ? "desc" : undefined,
      title: localeText(locale, "experimentList.passRateDescription"),
    });
  }
  if (showTotalScore) {
    columns.push({
      label: localeText(locale, "experimentList.totalScore"),
      numeric: true,
      defaultSort: composition === "points" ? "desc" : undefined,
      title: localeText(locale, "experimentList.totalScoreDescription"),
    });
  }
  columns.push(
    { label: localeText(locale, "experimentList.tokens"), numeric: true },
    { label: localeText(locale, "experimentList.cost"), numeric: true },
    { label: localeText(locale, "experimentList.result") },
  );
  const board = (
    <div className={cx("nre-experiment-table", composition === "mixed" && "nre-mixed-scoring")}>
      <div className="nre-experiment-head">
        {columns.map((col, index) => (
          <button
            type="button"
            data-nre-experiment-sort={index}
            className={cx(
              col.numeric && "nre-num-head",
              col.defaultSort === "asc" && "nre-sort-asc",
              col.defaultSort === "desc" && "nre-sort-desc",
            )}
            key={col.label}
            title={col.title}
          >
            <span className="nre-sort-label">{col.label}</span>
            <span className="nre-sort-icon" aria-hidden="true" />
          </button>
        ))}
      </div>
      {data.length === 0 && <p className="nre-experiment-list-empty">{localeText(locale, "attemptList.empty")}</p>}
      {data.map((item) => (
        <ExperimentRow
          key={item.experimentId}
          item={item}
          label={experimentLabels.get(item.experimentId) ?? item.experimentId}
          composition={composition}
          attemptHref={attemptHref}
          locale={locale}
        />
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
