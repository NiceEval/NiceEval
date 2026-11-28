import { useState, type ReactElement } from "react";
import { useTraceReveal } from "./matcher-trace-overlay.tsx";

import {
  resolveLocalizedText,
  type ClosedAssertionFactValue,
  type ClosedJsonValue,
  type LocalizedText,
  type ReportLocale,
} from "./shared.ts";

export type MatcherFilterRowState =
  | "matched"
  | "mismatched"
  | "unavailable"
  | "not-evaluated"
  | "not-retained"
  | "outside-snapshot"
  | "legacy";

export interface MatcherFilterFieldContent {
  readonly label: string;
  readonly value: string;
}

/** Command classification of a tool row, read from the Inspection projection. */
export type MatcherToolCommandContent =
  | { readonly kind: "unclassified" }
  | { readonly kind: "not-command" }
  | { readonly kind: "opaque"; readonly reason: string }
  | {
      readonly kind: "available";
      readonly normalization: "identity" | "pnpm-exec" | "npx";
      readonly omittedBytes: number;
      readonly evidenceHref: string | undefined;
    };

export interface MatcherFilterRowContent {
  readonly key: string;
  readonly number: string;
  readonly kind: "tool" | "event" | "legacy-source-row";
  readonly summary: string;
  /** Actual tool and invocation identity; present only on tool rows. */
  readonly toolCall: { readonly tool: string; readonly command: MatcherToolCommandContent } | undefined;
  readonly state: MatcherFilterRowState;
  readonly fields: readonly MatcherFilterFieldContent[];
  /** Retained per-row comparison, kept structured so the matcher tree renders with its own states. */
  readonly difference: ClosedAssertionFactValue | undefined;
  readonly conversationTarget:
    | {
        readonly anchor: string;
      }
    | undefined;
}

export interface MatcherFilterStepContent {
  readonly step: number;
  readonly summary: string;
  readonly state: "matched" | "possible" | "blocked" | "not-reached";
  readonly sourceRow: string | undefined;
  readonly conversationTarget:
    | {
        readonly anchor: string;
      }
    | undefined;
}

export interface MatcherFilterFactContent {
  readonly kind: "requirement" | "observed" | "examined" | "coverage" | "evaluation" | "relation" | "retention";
  readonly value: LocalizedText;
}

export interface MatcherComparatorContent {
  readonly kind: string;
  readonly display: string;
  /** Complete retained comparator payload from Inspection. */
  readonly value: ClosedJsonValue | undefined;
}

export type MatcherRetainedTarget =
  | { readonly state: "available"; readonly anchor: string }
  | { readonly state: "unavailable"; readonly reason: string };

export interface MatcherRetainedSourceTarget {
  readonly state: string;
  readonly anchor:
    | { readonly kind: "tool-occurrence"; readonly toolOccurrenceId: string }
    | { readonly kind: "event"; readonly eventId: string };
  readonly difference: ClosedJsonValue;
  /** Stable DOM anchor from the same trace projection, when retained. */
  readonly conversationTarget: { readonly anchor: string } | undefined;
}

export type MatcherCommandMatch =
  | { readonly state: "matched"; readonly commandId: string }
  | { readonly state: "unavailable"; readonly reason: string };

export interface MatcherFilterDebuggerContent {
  readonly state: "current" | "legacy";
  readonly queryKind: "collection-filter" | "ordered-sequence" | "unavailable";
  readonly subject: "tool" | "event" | "source-row";
  readonly querySummary: string;
  readonly facts: readonly MatcherFilterFactContent[];
  readonly steps: readonly MatcherFilterStepContent[];
  readonly failureFrontier:
    | {
        readonly definite: number;
        readonly possible: number;
        readonly blockingStep: number;
        readonly suffix: { readonly examined: number; readonly mismatched: number; readonly unavailable: number };
        readonly representatives: readonly MatcherFilterRowContent[];
      }
    | undefined;
  readonly overlayRetention: "complete" | "partial" | "unavailable";
  readonly atEvaluation: {
    readonly state: "complete" | "partial" | "unavailable";
    readonly rows: readonly MatcherFilterRowContent[];
    readonly notices: readonly MatcherFilterNotice[];
  };
  readonly afterEvaluation: readonly MatcherFilterRowContent[];
  readonly relationNotice: MatcherFilterNotice | undefined;
}

export type MatcherFilterNotice =
  | "historical-not-recorded"
  | "source-unavailable"
  | "ambiguous-relation"
  | "source-partial"
  | "overlay-partial";

function text(locale: ReportLocale, english: string, chinese: string): string {
  return locale === "zh-CN" ? chinese : english;
}

function factLabel(kind: MatcherFilterFactContent["kind"], locale: ReportLocale): string {
  switch (kind) {
    case "requirement":
      return text(locale, "Requirement", "目标");
    case "observed":
      return text(locale, "Observed", "结果");
    case "examined":
      return text(locale, "Examined", "检查范围");
    case "coverage":
      return text(locale, "Source", "记录完整度");
    case "evaluation":
      return text(locale, "Evaluation", "评估完整度");
    case "relation":
      return text(locale, "Row identity", "逐行关联");
    case "retention":
      return text(locale, "Overlay retention", "逐行结果保留");
  }
}

export function rowStateLabel(state: MatcherFilterRowState, locale: ReportLocale): string {
  switch (state) {
    case "matched":
      return text(locale, "Match", "命中");
    case "mismatched":
      return text(locale, "No match", "未命中");
    case "unavailable":
      return text(locale, "Unknown", "无法判断");
    case "not-evaluated":
      return text(locale, "Not evaluated", "未参与判断");
    case "not-retained":
      return text(locale, "Row result not retained", "逐行结果未保留");
    case "outside-snapshot":
      return text(locale, "After evaluation", "评估后出现");
    case "legacy":
      return text(locale, "Recorded", "已记录");
  }
}

/** Renders one retained row comparison; supplied by the owner of matcher diagnostic presentation. */
export type MatcherComparisonRenderer = (
  difference: ClosedAssertionFactValue,
  row: MatcherFilterRowContent,
) => ReactElement | null;

/** Human ledger number: tools use Tn and events En in canonical source order; numbering never changes. */
export function matcherRowNumber(row: Pick<MatcherFilterRowContent, "kind" | "number">): string {
  if (row.kind === "tool") return `T${row.number}`;
  if (row.kind === "event") return `E${row.number}`;
  return row.number;
}

function ledgerFieldLabel(label: string, locale: ReportLocale): string {
  if (locale !== "zh-CN") return label;
  switch (label) {
    case "name":
      return "名称";
    case "input":
      return "输入";
    case "output":
      return "输出";
    case "status":
      return "状态";
    case "command":
      return "命令";
    case "homeTurn":
      return "发起 Turn";
    case "finishTurn":
      return "结束 Turn";
    case "role":
      return "角色";
    case "text":
      return "文本";
    case "tool":
      return "工具";
    case "state":
      return "状态";
    case "summary":
      return "摘要";
    case "prompt":
      return "提问";
    case "response":
      return "回复";
    case "code":
      return "代码";
    case "type":
      return "类型";
    default:
      return label;
  }
}

/**
 * Invocation identity next to the row title: a command row names its actual tool and how it ran,
 * an opaque command names why argv is unavailable, and an unclassified call says so instead of guessing.
 */
export function toolCallText(toolCall: NonNullable<MatcherFilterRowContent["toolCall"]>, locale: ReportLocale): string {
  const command = toolCall.command;
  switch (command.kind) {
    case "not-command":
      return text(locale, "ordinary tool", "普通工具");
    case "unclassified":
      return text(locale, "unclassified by the Adapter", "Adapter 未分类");
    case "opaque":
      return `${toolCall.tool} · ${text(locale, `opaque command (${command.reason})`, `不透明命令（${command.reason}）`)}`;
    case "available": {
      const via =
        command.normalization === "identity"
          ? text(locale, "direct argv", "原始 argv")
          : text(
              locale,
              `via ${command.normalization === "pnpm-exec" ? "pnpm exec" : "npx"}`,
              `经 ${command.normalization === "pnpm-exec" ? "pnpm exec" : "npx"}`,
            );
      const omitted =
        command.omittedBytes === 0
          ? ""
          : ` · ${text(locale, `${command.omittedBytes} more bytes`, `另有 ${command.omittedBytes} 字节`)}`;
      return `${toolCall.tool} · ${via}${omitted}`;
    }
  }
}

function rowKindLabel(kind: MatcherFilterRowContent["kind"], locale: ReportLocale): string {
  switch (kind) {
    case "tool":
      return text(locale, "Tool call", "工具调用");
    case "event":
      return text(locale, "Event", "事件");
    case "legacy-source-row":
      return text(locale, "Record", "记录");
  }
}

function Fields({
  fields,
  locale,
}: {
  readonly fields: readonly MatcherFilterFieldContent[];
  readonly locale: ReportLocale;
}): ReactElement | null {
  if (fields.length === 0) return null;
  return (
    <dl className="niceeval-filter-row-fields">
      {fields.map((field, index) => {
        return (
          <div key={`${field.label}:${index}`}>
            <dt>{ledgerFieldLabel(field.label, locale)}</dt>
            <dd>
              <pre>{field.value}</pre>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function ConversationTarget({
  anchor,
  locale,
}: {
  readonly anchor: string;
  readonly locale: ReportLocale;
}): ReactElement {
  const reveal = useTraceReveal();
  return (
    <button
      type="button"
      className="niceeval-filter-row-target"
      onClick={() => {
        const target = document.getElementById(`conversation-${anchor}`) ?? document.getElementById(`trace-${anchor}`);
        if (!(target instanceof HTMLElement)) return;
        reveal?.setAnchor(anchor);
        for (let node: HTMLElement | null = target; node !== null; node = node.parentElement) {
          if (node instanceof HTMLDetailsElement) node.open = true;
        }
        requestAnimationFrame(() => {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          (target.querySelector<HTMLElement>("summary, button") ?? target).focus({ preventScroll: true });
          const highlight = "niceeval-conversation-target-highlight";
          target.classList.remove(highlight);
          void target.offsetWidth;
          target.classList.add(highlight);
          target.addEventListener("animationend", () => target.classList.remove(highlight), { once: true });
        });
      }}
    >
      {text(locale, "View in conversation", "在会话中查看")}
      <span aria-hidden="true">↗</span>
    </button>
  );
}

function Row({
  row,
  locale,
  renderComparison,
}: {
  readonly row: MatcherFilterRowContent;
  readonly locale: ReportLocale;
  readonly renderComparison: MatcherComparisonRenderer;
}): ReactElement {
  const title = `${rowKindLabel(row.kind, locale)} ${matcherRowNumber(row)}`;
  const comparison = row.difference === undefined ? null : renderComparison(row.difference, row);
  const command = row.toolCall?.command;
  const argvHref = command?.kind === "available" ? command.evidenceHref : undefined;
  const body =
    row.fields.length > 0 || comparison !== null || row.conversationTarget !== undefined || argvHref !== undefined;
  const summary = (
    <span className="niceeval-filter-row-summary">
      <span className="niceeval-filter-row-number">{title}</span>
      <strong>{row.summary}</strong>
      {row.toolCall === undefined ? null : (
        <span className="niceeval-filter-row-invocation">{toolCallText(row.toolCall, locale)}</span>
      )}
      <span className="niceeval-filter-row-state" data-state={row.state}>
        {rowStateLabel(row.state, locale)}
      </span>
    </span>
  );
  if (!body) {
    return (
      <div className="niceeval-filter-row" data-state={row.state}>
        {summary}
      </div>
    );
  }
  return (
    <details className="niceeval-filter-row" data-state={row.state}>
      <summary>{summary}</summary>
      <div className="niceeval-filter-row-detail">
        {comparison === null ? null : (
          <section className="niceeval-filter-comparison">
            <h6>{text(locale, "Filter comparison", "Filter 对比")}</h6>
            {comparison}
          </section>
        )}
        {row.fields.length === 0 ? null : (
          <section>
            <h6>{text(locale, "Recorded detail", "调用详情")}</h6>
            <Fields fields={row.fields} locale={locale} />
          </section>
        )}
        {row.conversationTarget === undefined ? null : (
          <ConversationTarget anchor={row.conversationTarget.anchor} locale={locale} />
        )}
        {argvHref === undefined ? null : <a href={argvHref}>{text(locale, "Read full argv", "查看完整 argv")}</a>}
      </div>
    </details>
  );
}

function stepStateLabel(state: MatcherFilterStepContent["state"], locale: ReportLocale): string {
  switch (state) {
    case "matched":
      return text(locale, "Matched", "已匹配");
    case "possible":
      return text(locale, "Possible", "可能匹配");
    case "blocked":
      return text(locale, "Blocked here", "阻塞于此");
    case "not-reached":
      return text(locale, "Not reached", "尚未到达");
  }
}

function Steps({
  steps,
  locale,
}: {
  readonly steps: readonly MatcherFilterStepContent[];
  readonly locale: ReportLocale;
}): ReactElement | null {
  if (steps.length === 0) return null;
  return (
    <section className="niceeval-filter-steps">
      <h5>{text(locale, "Sequence path", "顺序匹配路径")}</h5>
      <ol>
        {steps.map((step) => (
          <li key={step.step} data-state={step.state}>
            <span className="niceeval-filter-step-index">{step.step}</span>
            <code>{step.summary}</code>
            {step.sourceRow === undefined ? null : <span>{step.sourceRow}</span>}
            <span className="niceeval-filter-step-state">{stepStateLabel(step.state, locale)}</span>
            {step.conversationTarget === undefined ? null : (
              <ConversationTarget anchor={step.conversationTarget.anchor} locale={locale} />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function subjectPlural(subject: MatcherFilterDebuggerContent["subject"], locale: ReportLocale): string {
  if (subject === "tool") return text(locale, "tool calls", "工具调用");
  if (subject === "event") return text(locale, "events", "事件");
  return text(locale, "records", "记录");
}

interface OverlayRetention {
  readonly retained: number;
  readonly examined: number;
}

function hasRetainedComparison(row: MatcherFilterRowContent): boolean {
  return row.state === "matched" || row.state === "mismatched" || row.state === "unavailable";
}

function overlayRetention(rows: readonly MatcherFilterRowContent[]): OverlayRetention {
  const retained = rows.filter(hasRetainedComparison).length;
  return { retained, examined: retained + rows.filter((row) => row.state === "not-retained").length };
}

type LedgerFilter = "all" | "retained" | "matched" | "mismatched" | "unavailable" | "not-evaluated";

function ledgerFilters(content: MatcherFilterDebuggerContent): readonly LedgerFilter[] {
  if (content.overlayRetention === "unavailable") return ["all"];
  if (content.overlayRetention === "partial") return ["all", "retained"];
  const filters: LedgerFilter[] = ["all", "matched", "mismatched", "unavailable"];
  if (content.atEvaluation.rows.some((row) => row.state === "not-evaluated")) filters.push("not-evaluated");
  return filters;
}

function ledgerFilterLabel(filter: LedgerFilter, locale: ReportLocale): string {
  if (filter === "all") return text(locale, "All Records", "全部记录");
  if (filter === "retained") return text(locale, "Retained Evidence", "已保留证据");
  return rowStateLabel(filter, locale);
}

function FailureFrontier({
  frontier,
  locale,
  renderComparison,
}: {
  readonly frontier: NonNullable<MatcherFilterDebuggerContent["failureFrontier"]>;
  readonly locale: ReportLocale;
  readonly renderComparison: MatcherComparisonRenderer;
}): ReactElement {
  const { examined, mismatched, unavailable } = frontier.suffix;
  return (
    <section className="niceeval-filter-frontier">
      <h5>{text(locale, "Failure frontier", "失败边界")}</h5>
      <p>
        {text(
          locale,
          `Longest prefix: ${frontier.definite} definite, ${frontier.possible} possible · First blocking step ${frontier.blockingStep}`,
          `最长前缀：确定 ${frontier.definite} 步，可能 ${frontier.possible} 步 · 首个阻塞步骤 ${frontier.blockingStep}`,
        )}
      </p>
      <p>
        {text(
          locale,
          `Suffix: ${examined} checked · ${mismatched} mismatched · ${unavailable} unavailable`,
          `后续记录：检查 ${examined} · 未命中 ${mismatched} · 无法判断 ${unavailable}`,
        )}
      </p>
      {frontier.representatives.map((row) => (
        <div key={row.key}>
          <span>{matcherRowNumber(row)}</span>
          {row.difference === undefined ? null : renderComparison(row.difference, row)}
        </div>
      ))}
    </section>
  );
}

function noticeText(notice: MatcherFilterNotice, locale: ReportLocale, retention: OverlayRetention): string {
  switch (notice) {
    case "historical-not-recorded":
      return text(
        locale,
        "This historical Record did not retain this Matcher query or its row-by-row relation. Rerun it to inspect match reasons and paths.",
        "此历史 Record 未保存本次 Matcher 查询与逐行关联，重跑后可查看命中原因/匹配路径。",
      );
    case "source-unavailable":
      return text(locale, "The source records were not retained.", "没有保存可用的来源记录。");
    case "ambiguous-relation":
      return text(
        locale,
        "The stored identities cannot prove a unique assertion-to-row relation.",
        "已保存的身份无法证明断言与记录之间唯一对应。",
      );
    case "source-partial":
      return text(
        locale,
        "The source records may be incomplete; missing rows are not treated as mismatches.",
        "来源记录可能不完整；缺失记录不会被当作未命中。",
      );
    case "overlay-partial":
      return text(
        locale,
        `Only bounded representative comparisons were retained (retained ${retention.retained} / examined ${retention.examined}); other examined rows show “Row result not retained”.`,
        `只保留了有界的代表性对比（已保留 ${retention.retained} / 已检查 ${retention.examined}）；其余参与评估的记录显示“逐行结果未保留”。`,
      );
  }
}

function debuggerLabel(content: MatcherFilterDebuggerContent, locale: ReportLocale): string {
  if (content.queryKind === "ordered-sequence") {
    return text(locale, "Event order", "事件顺序");
  }
  if (content.subject === "tool") {
    return text(locale, "Tool call filter", "工具调用筛选");
  }
  return text(locale, "Event filter", "事件筛选");
}

function ledgerSummary(content: MatcherFilterDebuggerContent, subjects: string, locale: ReportLocale): string {
  const count = content.atEvaluation.rows.length;
  if (locale === "zh-CN") {
    return content.state === "legacy" ? `查看已记录的 ${count} 条${subjects}` : `查看评估时的 ${count} 条${subjects}`;
  }
  return content.state === "legacy"
    ? `View ${count} recorded ${subjects}`
    : `View the ${count} ${subjects} at evaluation`;
}

export function MatcherFilterDebugger({
  content,
  locale,
  renderComparison,
}: {
  readonly content: MatcherFilterDebuggerContent;
  readonly locale: ReportLocale;
  readonly renderComparison: MatcherComparisonRenderer;
}): ReactElement {
  const subjects = subjectPlural(content.subject, locale);
  const historical = content.state === "legacy";
  const retention = overlayRetention(content.atEvaluation.rows);
  const [selectedFilter, setSelectedFilter] = useState<LedgerFilter>("all");
  const filters = ledgerFilters(content);
  const filter = filters.includes(selectedFilter) ? selectedFilter : "all";
  const visibleRows = content.atEvaluation.rows.filter(
    (row) => filter === "all" || (filter === "retained" ? hasRetainedComparison(row) : row.state === filter),
  );
  return (
    <section
      className="niceeval-filter-debugger"
      aria-label={debuggerLabel(content, locale)}
      data-state={content.state}
      data-source-state={content.atEvaluation.state}
    >
      {historical ? null : (
        <header className="niceeval-filter-debugger-head">
          <span>{debuggerLabel(content, locale)}</span>
          <code>{content.querySummary}</code>
        </header>
      )}

      {content.facts.length === 0 ? null : (
        <dl className="niceeval-filter-facts">
          {content.facts.map((fact) => (
            <div key={fact.kind}>
              <dt>{factLabel(fact.kind, locale)}</dt>
              <dd>{resolveLocalizedText(fact.value, locale)}</dd>
            </div>
          ))}
        </dl>
      )}

      <Steps steps={content.steps} locale={locale} />
      {content.failureFrontier === undefined ? null : (
        <FailureFrontier frontier={content.failureFrontier} locale={locale} renderComparison={renderComparison} />
      )}

      {content.relationNotice === undefined ? null : (
        <p className="niceeval-filter-notice">{noticeText(content.relationNotice, locale, retention)}</p>
      )}
      {content.atEvaluation.notices.map((notice) => (
        <p key={notice} className="niceeval-filter-notice">
          {noticeText(notice, locale, retention)}
        </p>
      ))}

      <details className="niceeval-filter-ledger">
        <summary>
          <span>{ledgerSummary(content, subjects, locale)}</span>
          {historical && content.atEvaluation.state === "partial" ? (
            <small>{text(locale, "Records may be incomplete", "记录可能不完整")}</small>
          ) : null}
        </summary>
        <div className="niceeval-filter-ledger-content">
          {filters.length === 1 ? null : (
            <label>
              {text(locale, "Filter records", "筛选记录")}{" "}
              <select
                className="niceeval-filter-ledger-select"
                value={filter}
                onChange={(event) =>
                  setSelectedFilter(filters.find((value) => value === event.currentTarget.value) ?? "all")
                }
              >
                {filters.map((value) => (
                  <option key={value} value={value}>
                    {ledgerFilterLabel(value, locale)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p>
            {historical
              ? text(locale, "Open a row to inspect its recorded detail.", "展开任一行可查看已记录详情。")
              : text(
                  locale,
                  "Open a row to inspect its captured detail and filter comparison.",
                  "展开任一行可查看已记录详情和 Filter 对比。",
                )}
          </p>
          {visibleRows.length === 0 ? null : (
            <div className="niceeval-filter-rows">
              {visibleRows.map((row) => (
                <Row key={row.key} row={row} locale={locale} renderComparison={renderComparison} />
              ))}
            </div>
          )}
          {filter !== "all" && visibleRows.length === 0 ? (
            <p className="niceeval-filter-empty">
              {text(locale, "No records match this filter.", "没有符合筛选条件的记录。")}
            </p>
          ) : null}
          {content.atEvaluation.rows.length === 0 && (historical || content.atEvaluation.state !== "unavailable") ? (
            <p className="niceeval-filter-empty">
              {content.atEvaluation.state === "unavailable"
                ? text(locale, "Source rows were not recorded.", "没有记录可用的来源行。")
                : text(locale, `No ${subjects} were in this evaluation snapshot.`, `这个评估快照里没有${subjects}。`)}
            </p>
          ) : null}
        </div>
      </details>

      {content.afterEvaluation.length === 0 ? null : (
        <details className="niceeval-filter-later">
          <summary>
            {text(locale, `Context recorded after evaluation`, `评估后记录的上下文`)}
            <span>{content.afterEvaluation.length}</span>
          </summary>
          <p>
            {text(
              locale,
              "These rows are visible for context and did not affect the sealed result.",
              "这些行只用于查看上下文，不影响已经封口的判断结果。",
            )}
          </p>
          <div className="niceeval-filter-rows">
            {content.afterEvaluation.map((row) => (
              <Row key={row.key} row={row} locale={locale} renderComparison={renderComparison} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

export function matcherFilterDebuggerText(content: MatcherFilterDebuggerContent): string {
  const querySummary = content.state === "legacy" ? "Matcher query not recorded" : content.querySummary;
  const lines = [
    querySummary,
    ...content.facts.map((fact) => `${fact.kind}: ${resolveLocalizedText(fact.value, "en")}`),
  ];
  for (const step of content.steps) {
    lines.push(
      `${step.step}. ${step.summary}: ${step.state}${step.sourceRow === undefined ? "" : ` (${step.sourceRow})`}`,
    );
  }
  for (const row of [...content.atEvaluation.rows, ...content.afterEvaluation]) {
    lines.push(
      `${row.kind} ${matcherRowNumber(row)}: ${row.summary}${row.toolCall === undefined ? "" : ` (${toolCallText(row.toolCall, "en")})`} [${row.state}]`,
    );
  }
  return lines.join("\n");
}
