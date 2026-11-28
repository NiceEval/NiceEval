// Conversation:分轮事件流(docs/feature/reports/library.md)。
// SourceView 展开区与兜底区复用 ConversationEntries。

import { Fragment, type ReactElement, type ReactNode } from "react";
import { dataShapeError, isLocalizedText, isObject, type ValueProps } from "./shared.ts";
import {
  resolveLocalizedText,
  stripControl,
  type ClosedJsonValue,
  type LocalizedText,
  type ReportLocale,
} from "./shared.ts";
import { ToolEvidence, type ToolEvidenceContent } from "./tool-evidence.tsx";
import { rowStateLabel } from "./matcher-filter-debugger.tsx";
import { useAssertionTraceRow } from "./matcher-trace-overlay.tsx";

export type CommandMatch =
  | { readonly state: "matched"; readonly commandId: string }
  | { readonly state: "unavailable"; readonly reason: string };

export type ToolOccurrenceIdentity =
  | { readonly state: "exact"; readonly toolOccurrenceId: string }
  | { readonly state: "unavailable"; readonly reason: string };

export type ConversationDetail =
  | { readonly kind: "text"; readonly text: string; readonly className: string | undefined }
  | { readonly kind: "tool-evidence"; readonly content: ToolEvidenceContent }
  | { readonly kind: "stack"; readonly items: readonly ConversationDetail[] };

export interface ConversationEntry {
  /** Stable item identity supplied by the closed evidence; never derived from text or position. */
  id: string;
  eventId: string | undefined;
  sequence: number | undefined;
  kind: string;
  preview: LocalizedText;
  /** Exact Analysis-resolved target used by matcher debugger navigation. */
  anchor: string | undefined;
  detail: ConversationDetail | undefined;
  /** Exact retained evidence behind the compact preview. */
  raw: string | undefined;
  failed: boolean;
  /** Tool lifecycle hint used by the session summary; omitted for non-call rows. */
  callPhase: "started" | "finished" | undefined;
  /** Stable provider call identity when this row belongs to a tool lifecycle. */
  callId: string | undefined;
  /** Current exact/unavailable tool occurrence identity, retained without coercion. */
  toolOccurrence: ToolOccurrenceIdentity | undefined;
  /** Provider-neutral terminal outcome; omitted while the call is still open. */
  callOutcome: "completed" | "failed" | "rejected" | "cancelled" | undefined;
  /** Explicit tool occurrence → command join. No textual or ordinal fallback is permitted. */
  commandMatch: CommandMatch | undefined;
}

export interface ConversationTurn {
  key: string;
  label: LocalizedText;
  durationMs: number | undefined;
  verdict: "passed" | "failed" | "errored" | "skipped" | undefined;
  entries: readonly ConversationEntry[];
}

/** 独立生命周期命令证据卡;不属于 Conversation 的轮次或消息。 */
export interface CommandEvidenceItem {
  /** Exact command identity supplied by the explicit commandMatch join. */
  commandId: string;
  phase: string;
  display: string;
  exitCode: number | undefined;
  outcome: ClosedJsonValue;
  classification: "succeeded" | "observed" | "failed";
  stdout: string | undefined;
  stderr: string | undefined;
}

export interface ConversationContent {
  turns: readonly ConversationTurn[];
  /** Canonical locator for the one closed Attempt evidence bundle. */
  locator: string | undefined;
}

export interface CommandEvidenceContent {
  commands: readonly CommandEvidenceItem[];
  locator: string | undefined;
}

export type ConversationProps = ValueProps<
  ConversationContent | undefined,
  { locale: ReportLocale; className: string | undefined; title: LocalizedText | undefined }
>;

function cx(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Render an already-closed entry detail inside another report primitive.
 *
 * Conversation and TurnTrace deliberately share this small bridge instead of
 * asking the browser to recover evidence from an existing DOM row.  The
 * caller still emits every evidence surface during SSR.
 */
export function renderConversationDetail(node: ConversationDetail, locale: ReportLocale): ReactNode {
  if (node.kind === "tool-evidence") return <ToolEvidence content={node.content} locale={locale} />;
  if (node.kind === "text") {
    return <div className={cx("niceeval-report", "niceeval-text", node.className)}>{node.text}</div>;
  }
  return node.items.map((item, index) => <Fragment key={index}>{renderConversationDetail(item, locale)}</Fragment>);
}

export function sanitizeConversationPreview(text: LocalizedText, locale: ReportLocale, max = 140): string {
  const raw = resolveLocalizedText(text, locale);
  const oneLine = stripControl(raw).replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

function validateEntry(value: unknown, path: string): string | undefined {
  if (!isObject(value)) return `"${path}" must be an object`;
  if (typeof value.id !== "string") return `"${path}.id" must be a stable string`;
  if (typeof value.kind !== "string") return `"${path}.kind" must be a string`;
  if (!isLocalizedText(value.preview)) return `"${path}.preview" must be a LocalizedText`;
  if (value.failed !== undefined && typeof value.failed !== "boolean") {
    return `"${path}.failed" must be a boolean`;
  }
  if (value.raw !== undefined && typeof value.raw !== "string") return `"${path}.raw" must be a string`;
  if (value.anchor !== undefined && typeof value.anchor !== "string") return `"${path}.anchor" must be a string`;
  if (value.callId !== undefined && typeof value.callId !== "string") return `"${path}.callId" must be a string`;
  if (value.callPhase !== undefined && value.callPhase !== "started" && value.callPhase !== "finished") {
    return `"${path}.callPhase" must be started | finished`;
  }
  if (
    value.callOutcome !== undefined &&
    value.callOutcome !== "completed" &&
    value.callOutcome !== "failed" &&
    value.callOutcome !== "rejected" &&
    value.callOutcome !== "cancelled"
  ) {
    return `"${path}.callOutcome" must be completed | failed | rejected | cancelled`;
  }
  return undefined;
}

function validateTurn(value: unknown, path: string): string | undefined {
  if (!isObject(value)) return `"${path}" must be an object`;
  if (typeof value.key !== "string") return `"${path}.key" must be a string`;
  if (!isLocalizedText(value.label)) return `"${path}.label" must be a LocalizedText`;
  if (
    value.durationMs !== undefined &&
    (typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs) || value.durationMs < 0)
  ) {
    return `"${path}.durationMs" must be a non-negative number`;
  }
  if (
    value.verdict !== undefined &&
    value.verdict !== "passed" &&
    value.verdict !== "failed" &&
    value.verdict !== "errored" &&
    value.verdict !== "skipped"
  ) {
    return `"${path}.verdict" must be passed | failed | errored | skipped`;
  }
  if (!Array.isArray(value.entries)) return `"${path}.entries" must be an array`;
  for (let i = 0; i < value.entries.length; i++) {
    const problem = validateEntry(value.entries[i], `${path}.entries[${i}]`);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

function assertConversationContent(data: unknown): ConversationContent | undefined {
  if (data === null || data === undefined) return undefined;
  if (!isObject(data)) {
    throw dataShapeError("Conversation", "conversationData", "ConversationContent", '"data" must be an object or null');
  }
  if (!Array.isArray(data.turns)) {
    throw dataShapeError("Conversation", "conversationData", "ConversationContent", '"data.turns" must be an array');
  }
  for (let i = 0; i < data.turns.length; i++) {
    const problem = validateTurn(data.turns[i], `data.turns[${i}]`);
    if (problem !== undefined) throw dataShapeError("Conversation", "conversationData", "ConversationContent", problem);
  }
  return data as unknown as ConversationContent;
}

// PageContext 不携带 input；下钻只来自 data.locator 的 attempt 目标命令
// （conversationText 的 baseCommand 分支）。

function EntryRow({ entry, locale }: { entry: ConversationEntry; locale: ReportLocale }): ReactElement {
  const preview = sanitizeConversationPreview(entry.preview, locale);
  const assertionState = useAssertionTraceRow(entry.anchor);
  const head = (
    <>
      <span className="niceeval-conversation-entry-kind" data-kind={entry.kind}>
        {entry.kind}
      </span>
      <span className="niceeval-conversation-entry-preview">{preview}</span>
      {assertionState === undefined ? null : (
        <small className="niceeval-trace-assertion-state" data-state={assertionState}>
          {rowStateLabel(assertionState, locale)}
        </small>
      )}
    </>
  );
  const detail = entry.detail !== undefined ? renderConversationDetail(entry.detail, locale) : null;
  if (detail === null || detail === undefined || detail === false) {
    return (
      <div
        className={cx("niceeval-conversation-entry", entry.failed && "niceeval-conversation-entry--failed")}
        id={`conversation-${entry.anchor}`}
        role="button"
        tabIndex={0}
      >
        {head}
      </div>
    );
  }
  return (
    <details
      className={cx(
        "niceeval-conversation-entry",
        "niceeval-conversation-entry--expandable",
        entry.failed && "niceeval-conversation-entry--failed",
      )}
      id={`conversation-${entry.anchor}`}
    >
      <summary className="niceeval-conversation-entry-summary">{head}</summary>
      <div className="niceeval-conversation-entry-detail">{detail}</div>
    </details>
  );
}

/** SourceView 等复用：渲染一轮内的条目列表。 */
export function ConversationEntries({
  entries,
  locale,
}: {
  entries: readonly ConversationEntry[];
  locale: ReportLocale;
}): ReactElement {
  return (
    <div className="niceeval-conversation-entries">
      {entries.map((entry, i) => (
        <EntryRow key={entry.id || i} entry={entry} locale={locale} />
      ))}
    </div>
  );
}

function TurnCard({ turn, locale }: { turn: ConversationTurn; locale: ReportLocale }): ReactElement {
  return (
    <article
      className={cx("niceeval-conversation-turn", turn.verdict && `niceeval-conversation-turn--${turn.verdict}`)}
    >
      <header className="niceeval-conversation-turn-head">
        <span className="niceeval-conversation-turn-label">{resolveLocalizedText(turn.label, locale)}</span>
        {turn.durationMs !== undefined ? (
          <span className="niceeval-conversation-turn-duration">{formatSessionDuration(turn.durationMs)}</span>
        ) : null}
        {turn.verdict ? <span className="niceeval-conversation-turn-verdict">{turn.verdict}</span> : null}
      </header>
      <ConversationEntries entries={turn.entries} locale={locale} />
    </article>
  );
}

function formatSessionDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`;
  const seconds = Math.round(durationMs / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function SessionSummary({
  content,
  title,
  locale,
}: {
  content: ConversationContent;
  title: LocalizedText | undefined;
  locale: ReportLocale;
}): ReactElement {
  const durations = content.turns.flatMap((turn) => (turn.durationMs === undefined ? [] : [turn.durationMs]));
  const calls = content.turns.reduce(
    (count, turn) => count + turn.entries.filter((entry) => entry.callPhase === "started").length,
    0,
  );
  const duration =
    durations.length === 0 ? "—" : formatSessionDuration(durations.reduce((total, value) => total + value, 0));
  return (
    <header className="niceeval-conversation-session-head">
      <span className="niceeval-conversation-session-title">
        {title === undefined ? "Session log" : resolveLocalizedText(title, locale)}
      </span>
      <dl className="niceeval-conversation-session-stats">
        <div>
          <dt>Duration</dt>
          <dd>{duration}</dd>
        </div>
        <div>
          <dt>Turns</dt>
          <dd>{content.turns.length}</dd>
        </div>
        <div>
          <dt>Calls</dt>
          <dd>{calls}</dd>
        </div>
      </dl>
    </header>
  );
}

function commandEvidenceTitle(command: CommandEvidenceItem): string {
  function classificationTitle(): string {
    switch (command.classification) {
      case "succeeded":
        return "COMMAND";
      case "failed":
        return "FAILED COMMAND";
      default:
        return "NON-ZERO COMMAND · observed";
    }
  }
  function resultText() {
    if (command.exitCode !== undefined) return `exit ${command.exitCode}`;
    if (typeof command.outcome === "string") return command.outcome;
    return JSON.stringify(command.outcome);
  }
  return `${classificationTitle()} · ${command.phase} · ${resultText()}`;
}

function CommandEvidenceCard({ command }: { command: CommandEvidenceItem }): ReactElement {
  return (
    <article className={cx("niceeval-command-evidence-card", `niceeval-command-evidence--${command.classification}`)}>
      <header className="niceeval-conversation-turn-head">
        <span className="niceeval-conversation-turn-label">{commandEvidenceTitle(command)}</span>
      </header>
      <div className="niceeval-command-evidence-display">{command.display}</div>
      {command.stdout ? (
        <details className="niceeval-conversation-entry niceeval-conversation-entry--expandable">
          <summary className="niceeval-conversation-entry-summary">stdout</summary>
          <pre className="niceeval-conversation-io">{command.stdout}</pre>
        </details>
      ) : null}
      {command.stderr ? (
        <details className="niceeval-conversation-entry niceeval-conversation-entry--expandable" open>
          <summary className="niceeval-conversation-entry-summary">stderr</summary>
          <pre className="niceeval-conversation-io">{command.stderr}</pre>
        </details>
      ) : null}
    </article>
  );
}

export function conversationText(data: ConversationContent, locale: ReportLocale, drillDown?: string): string {
  const head = [`conversation: ${data.turns.length} round${data.turns.length === 1 ? "" : "s"}`];
  const command = drillDown;
  if (command) head.push(command);
  const lines = [head.join(" · ")];
  for (const turn of data.turns) {
    const label = sanitizeConversationPreview(turn.label, locale);
    const verdict = turn.verdict ? ` (${turn.verdict})` : "";
    lines.push(`  ${label}${verdict}`);
  }
  return lines.join("\n");
}

function assertCommandEvidenceContent(data: unknown): CommandEvidenceContent | undefined {
  if (data === null || data === undefined) return undefined;
  if (!isObject(data) || !Array.isArray(data.commands)) {
    throw dataShapeError(
      "CommandEvidence",
      "commandEvidenceData",
      "CommandEvidenceContent",
      '"data.commands" must be an array',
    );
  }
  for (const [index, command] of data.commands.entries()) {
    if (!isObject(command))
      throw dataShapeError(
        "CommandEvidence",
        "commandEvidenceData",
        "CommandEvidenceContent",
        `"data.commands[${index}]" must be an object`,
      );
    if (typeof command.commandId !== "string")
      throw dataShapeError(
        "CommandEvidence",
        "commandEvidenceData",
        "CommandEvidenceContent",
        `"data.commands[${index}].commandId" must be a string`,
      );
    if (typeof command.phase !== "string")
      throw dataShapeError(
        "CommandEvidence",
        "commandEvidenceData",
        "CommandEvidenceContent",
        `"data.commands[${index}].phase" must be a string`,
      );
    if (typeof command.display !== "string")
      throw dataShapeError(
        "CommandEvidence",
        "commandEvidenceData",
        "CommandEvidenceContent",
        `"data.commands[${index}].display" must be a string`,
      );
    if (command.exitCode !== undefined && typeof command.exitCode !== "number")
      throw dataShapeError(
        "CommandEvidence",
        "commandEvidenceData",
        "CommandEvidenceContent",
        `"data.commands[${index}].exitCode" must be a number`,
      );
    if (command.outcome === undefined)
      throw dataShapeError(
        "CommandEvidence",
        "commandEvidenceData",
        "CommandEvidenceContent",
        `"data.commands[${index}].outcome" must be present`,
      );
    if (
      command.classification !== "succeeded" &&
      command.classification !== "observed" &&
      command.classification !== "failed"
    ) {
      throw dataShapeError(
        "CommandEvidence",
        "commandEvidenceData",
        "CommandEvidenceContent",
        `"data.commands[${index}].classification" must be succeeded | observed | failed`,
      );
    }
    if (command.stdout !== undefined && typeof command.stdout !== "string")
      throw dataShapeError(
        "CommandEvidence",
        "commandEvidenceData",
        "CommandEvidenceContent",
        `"data.commands[${index}].stdout" must be a string`,
      );
    if (command.stderr !== undefined && typeof command.stderr !== "string")
      throw dataShapeError(
        "CommandEvidence",
        "commandEvidenceData",
        "CommandEvidenceContent",
        `"data.commands[${index}].stderr" must be a string`,
      );
  }
  return data as unknown as CommandEvidenceContent;
}

export type CommandEvidenceProps = ValueProps<
  CommandEvidenceContent | undefined,
  { locale: ReportLocale; className: string | undefined }
>;

export function commandEvidenceText(data: CommandEvidenceContent | undefined): string {
  const content = assertCommandEvidenceContent(data);
  if (content === undefined || content.commands.length === 0) return "";
  const lines = [`commands: ${content.commands.length}`];
  for (const command of content.commands) {
    lines.push(`  ${commandEvidenceTitle(command)}`);
    lines.push(`    ${command.display}`);
    if (command.stdout) lines.push(`    stdout\n      ${command.stdout.replace(/\n/g, "\n      ")}`);
    if (command.stderr) lines.push(`    stderr\n      ${command.stderr.replace(/\n/g, "\n      ")}`);
  }
  return lines.join("\n");
}

export function CommandEvidence({ data, className, locale }: CommandEvidenceProps): ReactElement | null {
  const content = assertCommandEvidenceContent(data);
  if (content === undefined || content.commands.length === 0) return null;
  return (
    <section className={cx("niceeval-report", "niceeval-command-evidence", className)}>
      <details className="niceeval-command-evidence-region">
        <summary className="niceeval-command-evidence-summary">
          {resolveLocalizedText(
            { en: `Commands · ${content.commands.length}`, "zh-CN": `命令证据 · ${content.commands.length}` },
            locale,
          )}
        </summary>
        <div className="niceeval-command-evidence-cards">
          {content.commands.map((command) => (
            <CommandEvidenceCard key={command.commandId} command={command} />
          ))}
        </div>
      </details>
    </section>
  );
}

export function Conversation({ data, className, locale, title }: ConversationProps): ReactElement | null {
  const content = assertConversationContent(data);
  if (content === undefined || content.turns.length === 0) return null;
  return (
    <div className={cx("niceeval-report", "niceeval-conversation", className)}>
      <SessionSummary content={content} title={title} locale={locale} />
      {content.turns.map((turn) => (
        <TurnCard key={turn.key} turn={turn} locale={locale} />
      ))}
    </div>
  );
}
