import type { ReactElement } from "react";

import { resolveLocalizedText, type LocalizedText, type ReportLocale } from "../../model/locale.ts";

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
  readonly state?: "matched" | "mismatched" | "unavailable";
}

export interface MatcherFilterRowContent {
  readonly key: string;
  readonly number: string;
  readonly kind: "tool" | "event" | "legacy-source-row";
  readonly summary: string;
  readonly state: MatcherFilterRowState;
  readonly note?: string;
  readonly fields: readonly MatcherFilterFieldContent[];
  readonly difference?: readonly MatcherFilterFieldContent[];
  readonly conversationTarget?: {
    readonly anchor: string;
  };
}

export interface MatcherFilterStepContent {
  readonly step: number;
  readonly summary: string;
  readonly state: "matched" | "possible" | "blocked" | "not-reached";
  readonly sourceRow?: string;
  readonly conversationTarget?: {
    readonly anchor: string;
  };
}

export interface MatcherFilterFactContent {
  readonly kind: "requirement" | "observed" | "examined" | "coverage";
  readonly value: LocalizedText;
}

export interface MatcherFilterDebuggerContent {
  readonly state: "current" | "legacy";
  readonly queryKind: "collection-filter" | "ordered-sequence" | "unavailable";
  readonly subject: "tool" | "event" | "source-row";
  readonly querySummary: string;
  readonly facts: readonly MatcherFilterFactContent[];
  readonly steps?: readonly MatcherFilterStepContent[];
  readonly atEvaluation: {
    readonly state: "complete" | "partial" | "unavailable";
    readonly rows: readonly MatcherFilterRowContent[];
    readonly notices?: readonly MatcherFilterNotice[];
  };
  readonly afterEvaluation: readonly MatcherFilterRowContent[];
  readonly relationNotice?: MatcherFilterNotice;
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
  }
}

function rowStateLabel(state: MatcherFilterRowState, locale: ReportLocale): string {
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
      return text(locale, "Checked", "已检查");
    case "outside-snapshot":
      return text(locale, "After evaluation", "评估后出现");
    case "legacy":
      return text(locale, "Recorded", "已记录");
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

function fieldStateLabel(
  state: MatcherFilterFieldContent["state"],
  locale: ReportLocale,
): string | null {
  if (state === undefined) return null;
  if (state === "matched") return text(locale, "match", "命中");
  if (state === "mismatched") return text(locale, "different", "不匹配");
  return text(locale, "unknown", "无法判断");
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
        const state = fieldStateLabel(field.state, locale);
        return (
          <div key={`${field.label}:${index}`} data-field-state={field.state}>
            <dt>{field.label}</dt>
            <dd><pre>{field.value}</pre></dd>
            {state === null ? null : <span>{state}</span>}
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
  return (
    <button
      type="button"
      className="niceeval-filter-row-target"
      data-niceeval-match-target={anchor}
    >
      {text(locale, "View in conversation", "在会话中查看")}
      <span aria-hidden="true">↗</span>
    </button>
  );
}

function Row({ row, locale }: {
  readonly row: MatcherFilterRowContent;
  readonly locale: ReportLocale;
}): ReactElement {
  const title = `${rowKindLabel(row.kind, locale)} ${row.number}`;
  const body = row.fields.length > 0 || (row.difference?.length ?? 0) > 0 ||
    row.note !== undefined || row.conversationTarget !== undefined;
  const summary = (
    <span className="niceeval-filter-row-summary">
      <span className="niceeval-filter-row-number">{title}</span>
      <strong>{row.summary}</strong>
      <span className="niceeval-filter-row-state" data-state={row.state}>
        {rowStateLabel(row.state, locale)}
      </span>
    </span>
  );
  if (!body) {
    return <div className="niceeval-filter-row" data-state={row.state}>{summary}</div>;
  }
  return (
    <details className="niceeval-filter-row" data-state={row.state}>
      <summary>{summary}</summary>
      <div className="niceeval-filter-row-detail">
        {row.note === undefined ? null : <p className="niceeval-filter-row-note">{row.note}</p>}
        {row.difference === undefined || row.difference.length === 0 ? null : (
          <section>
            <h6>{text(locale, "Filter comparison", "Filter 对比")}</h6>
            <Fields fields={row.difference} locale={locale} />
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

function noticeText(notice: MatcherFilterNotice, locale: ReportLocale): string {
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
      return text(locale, "The source records may be incomplete; missing rows are not treated as mismatches.", "来源记录可能不完整；缺失记录不会被当作未命中。");
    case "overlay-partial":
      return text(locale, "Only bounded representative comparisons were retained; other examined rows are marked as checked.", "只保留了有界的代表性对比；其余参与评估的记录标记为“已检查”。");
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

function ledgerSummary(
  content: MatcherFilterDebuggerContent,
  subjects: string,
  locale: ReportLocale,
): string {
  const count = content.atEvaluation.rows.length;
  if (locale === "zh-CN") {
    return content.state === "legacy"
      ? `查看已记录的 ${count} 条${subjects}`
      : `查看评估时的 ${count} 条${subjects}`;
  }
  return content.state === "legacy"
    ? `View ${count} recorded ${subjects}`
    : `View the ${count} ${subjects} at evaluation`;
}

export function MatcherFilterDebugger({
  content,
  locale,
}: {
  readonly content: MatcherFilterDebuggerContent;
  readonly locale: ReportLocale;
}): ReactElement {
  const subjects = subjectPlural(content.subject, locale);
  const historical = content.state === "legacy";
  return (
    <section
      className="niceeval-filter-debugger"
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

      <Steps steps={content.steps ?? []} locale={locale} />

      {content.relationNotice === undefined ? null : (
        <p className="niceeval-filter-notice">{noticeText(content.relationNotice, locale)}</p>
      )}
      {(content.atEvaluation.notices ?? []).map((notice) => (
        <p key={notice} className="niceeval-filter-notice">{noticeText(notice, locale)}</p>
      ))}

      <details className="niceeval-filter-ledger">
        <summary>
          <span>{ledgerSummary(content, subjects, locale)}</span>
          {historical && content.atEvaluation.state === "partial" ? (
            <small>{text(locale, "Records may be incomplete", "记录可能不完整")}</small>
          ) : null}
        </summary>
        <div className="niceeval-filter-ledger-content">
          <p>{historical
            ? text(locale, "Open a row to inspect its recorded detail.", "展开任一行可查看已记录详情。")
            : text(
                locale,
                "Open a row to inspect its captured detail and filter comparison.",
                "展开任一行可查看已记录详情和 Filter 对比。",
              )}</p>
          {content.atEvaluation.rows.length === 0 ? null : (
            <div className="niceeval-filter-rows">
              {content.atEvaluation.rows.map((row) => <Row key={row.key} row={row} locale={locale} />)}
            </div>
          )}
          {content.atEvaluation.rows.length === 0 &&
              (historical || content.atEvaluation.state !== "unavailable") ? (
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
          <p>{text(
            locale,
            "These rows are visible for context and did not affect the sealed result.",
            "这些行只用于查看上下文，不影响已经封口的判断结果。",
          )}</p>
          <div className="niceeval-filter-rows">
            {content.afterEvaluation.map((row) => <Row key={row.key} row={row} locale={locale} />)}
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
  for (const step of content.steps ?? []) {
    lines.push(`${step.step}. ${step.summary}: ${step.state}${step.sourceRow === undefined ? "" : ` (${step.sourceRow})`}`);
  }
  for (const row of [...content.atEvaluation.rows, ...content.afterEvaluation]) {
    lines.push(`${row.kind} ${row.number}: ${row.summary} [${row.state}]`);
  }
  return lines.join("\n");
}
