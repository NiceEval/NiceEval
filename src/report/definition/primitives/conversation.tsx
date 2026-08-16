// Conversation:分轮事件流(docs/feature/reports/library.md)。
// SourceView 展开区与兜底区复用 ConversationEntries。

import { createElement, Fragment, type ReactElement, type ReactNode } from "react";
import type { AttemptLocator } from "../../../attempt-locator.ts";
import { attemptPageTarget } from "./shared.ts";
import { stripControl } from "../../../assertions/display.ts";
import {
  dataShapeError,
  isLocalizedText,
  isObject,
  type ValueProps,
} from "./shared.ts";
import { resolveLocalizedText, type LocalizedText, type ReportLocale } from "../../model/locale.ts";
import { defineComponent, type ReportNode, type ResolveContext, type TextContext } from "../tree.ts";

const REACT_FRAGMENT = Symbol.for("react.fragment");

export interface ConversationEntry {
  kind: string;
  preview: LocalizedText;
  detail?: ReportNode;
  failed?: boolean;
}

export interface ConversationTurn {
  key: string;
  label: LocalizedText;
  verdict?: "passed" | "failed" | "errored" | "skipped";
  entries: readonly ConversationEntry[];
}

/** 独立生命周期命令证据卡;不属于 Conversation 的轮次或消息。 */
export interface CommandEvidenceItem {
  key: string;
  timingNodeId: string;
  phase: string;
  display: string;
  exitCode: number;
  classification: "succeeded" | "observed" | "failed";
  durationMs?: number;
  stdout?: string;
  stderr?: string;
}

export interface ConversationContent {
  turns: readonly ConversationTurn[];
  /** text 面 `--execution` 下钻;数据源投影时填入。 */
  locator?: AttemptLocator;
}

export interface CommandEvidenceContent {
  commands: readonly CommandEvidenceItem[];
  locator?: AttemptLocator;
}

export type ConversationProps = ValueProps<
  ConversationContent | null,
  { locale?: ReportLocale; className?: string }
>;

type ResolvedConversationProps = {
  data: ConversationContent | null;
  drillDown?: string;
  locale?: ReportLocale;
  className?: string;
};

function cx(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(" ");
}

function renderReportNode(node: ReportNode): ReactNode {
  if (node === null || node === undefined || typeof node === "boolean") return null;
  if (Array.isArray(node)) {
    return node.map((child, i) => <Fragment key={i}>{renderReportNode(child)}</Fragment>);
  }
  if (typeof node === "string" || typeof node === "number") return null;
  const el = node as { type: unknown; props: globalThis.Record<string, unknown> };
  if (el.type === REACT_FRAGMENT) {
    return createElement(Fragment, null, renderReportNode(el.props.children as ReportNode));
  }
  return createElement(el.type as never, el.props);
}

export function sanitizeConversationPreview(text: LocalizedText, locale: ReportLocale, max = 140): string {
  const raw = resolveLocalizedText(text, locale);
  const oneLine = stripControl(raw).replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

function validateEntry(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an object`;
  if (typeof value.kind !== "string") return `"${path}.kind" must be a string`;
  if (!isLocalizedText(value.preview)) return `"${path}.preview" must be a LocalizedText`;
  if (value.failed !== undefined && typeof value.failed !== "boolean") {
    return `"${path}.failed" must be a boolean`;
  }
  return null;
}

function validateTurn(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an object`;
  if (typeof value.key !== "string") return `"${path}.key" must be a string`;
  if (!isLocalizedText(value.label)) return `"${path}.label" must be a LocalizedText`;
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
    if (problem !== null) return problem;
  }
  return null;
}

function assertConversationContent(data: unknown): ConversationContent | null {
  if (data === null || data === undefined) return null;
  if (!isObject(data)) {
    throw dataShapeError("Conversation", "conversationData", "ConversationContent", '"data" must be an object or null');
  }
  if (!Array.isArray(data.turns)) {
    throw dataShapeError("Conversation", "conversationData", "ConversationContent", '"data.turns" must be an array');
  }
  for (let i = 0; i < data.turns.length; i++) {
    const problem = validateTurn(data.turns[i], `data.turns[${i}]`);
    if (problem !== null) throw dataShapeError("Conversation", "conversationData", "ConversationContent", problem);
  }
  return data as unknown as ConversationContent;
}

function isEmptyConversation(data: ConversationContent | null): boolean {
  if (data === null) return true;
  return data.turns.length === 0;
}

// PageContext 不携带 input；下钻只来自 data.locator 的 attempt 目标命令
// （conversationText 的 baseCommand 分支）。

function EntryRow({ entry, locale }: { entry: ConversationEntry; locale: ReportLocale }): ReactElement {
  const preview = sanitizeConversationPreview(entry.preview, locale);
  const head = (
    <>
      <span className="niceeval-conversation-entry-kind" data-kind={entry.kind}>
        {entry.kind}
      </span>
      <span className="niceeval-conversation-entry-preview">{preview}</span>
    </>
  );
  const detail = entry.detail !== undefined ? renderReportNode(entry.detail) : null;
  if (detail === null || detail === undefined || detail === false) {
    return (
      <div className={cx("niceeval-conversation-entry", entry.failed && "niceeval-conversation-entry--failed")}>{head}</div>
    );
  }
  return (
    <details
      className={cx(
        "niceeval-conversation-entry",
        "niceeval-conversation-entry--expandable",
        entry.failed && "niceeval-conversation-entry--failed",
      )}
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
        <EntryRow key={i} entry={entry} locale={locale} />
      ))}
    </div>
  );
}

function TurnCard({ turn, locale }: { turn: ConversationTurn; locale: ReportLocale }): ReactElement {
  return (
    <article className={cx("niceeval-conversation-turn", turn.verdict && `niceeval-conversation-turn--${turn.verdict}`)}>
      <header className="niceeval-conversation-turn-head">
        <span className="niceeval-conversation-turn-label">{resolveLocalizedText(turn.label, locale)}</span>
        {turn.verdict ? <span className="niceeval-conversation-turn-verdict">{turn.verdict}</span> : null}
      </header>
      <ConversationEntries entries={turn.entries} locale={locale} />
    </article>
  );
}

function commandEvidenceTitle(command: CommandEvidenceItem): string {
  const title =
    command.classification === "succeeded" ? "COMMAND"
    : command.classification === "failed" ? "FAILED COMMAND"
    : "NON-ZERO COMMAND · observed";
  return `${title} · ${command.phase} · exit ${command.exitCode}${command.durationMs === undefined ? "" : ` · ${command.durationMs}ms`}`;
}

function CommandEvidenceCard({ command }: { command: CommandEvidenceItem }): ReactElement {
  return (
    <article className={cx("niceeval-command-evidence-card", `niceeval-command-evidence--${command.classification}`)}>
      <header className="niceeval-conversation-turn-head">
        <span className="niceeval-conversation-turn-label">
          {commandEvidenceTitle(command)}
        </span>
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

export function conversationText(
  data: ConversationContent,
  ctx: TextContext,
  locale: ReportLocale,
  drillDown?: string,
): string {
  const head = [`conversation: ${data.turns.length} round${data.turns.length === 1 ? "" : "s"}`];
  const baseCommand =
    data.locator !== undefined ? ctx.command(attemptPageTarget(data.locator)) : undefined;
  const command = drillDown ?? (baseCommand !== undefined ? `${baseCommand} --execution` : undefined);
  if (command) head.push(command);
  const lines = [head.join(" · ")];
  for (const turn of data.turns) {
    const label = sanitizeConversationPreview(turn.label, locale);
    const verdict = turn.verdict ? ` (${turn.verdict})` : "";
    lines.push(`  ${label}${verdict}`);
  }
  return lines.join("\n");
}

function assertCommandEvidenceContent(data: unknown): CommandEvidenceContent | null {
  if (data === null || data === undefined) return null;
  if (!isObject(data) || !Array.isArray(data.commands)) {
    throw dataShapeError("CommandEvidence", "commandEvidenceData", "CommandEvidenceContent", '"data.commands" must be an array');
  }
  for (const [index, command] of data.commands.entries()) {
    if (!isObject(command)) throw dataShapeError("CommandEvidence", "commandEvidenceData", "CommandEvidenceContent", `"data.commands[${index}]" must be an object`);
    if (typeof command.key !== "string") throw dataShapeError("CommandEvidence", "commandEvidenceData", "CommandEvidenceContent", `"data.commands[${index}].key" must be a string`);
    if (typeof command.phase !== "string") throw dataShapeError("CommandEvidence", "commandEvidenceData", "CommandEvidenceContent", `"data.commands[${index}].phase" must be a string`);
    if (typeof command.display !== "string") throw dataShapeError("CommandEvidence", "commandEvidenceData", "CommandEvidenceContent", `"data.commands[${index}].display" must be a string`);
    if (typeof command.exitCode !== "number") throw dataShapeError("CommandEvidence", "commandEvidenceData", "CommandEvidenceContent", `"data.commands[${index}].exitCode" must be a number`);
    if (command.classification !== "succeeded" && command.classification !== "observed" && command.classification !== "failed") {
      throw dataShapeError("CommandEvidence", "commandEvidenceData", "CommandEvidenceContent", `"data.commands[${index}].classification" must be succeeded | observed | failed`);
    }
    if (command.durationMs !== undefined && typeof command.durationMs !== "number") throw dataShapeError("CommandEvidence", "commandEvidenceData", "CommandEvidenceContent", `"data.commands[${index}].durationMs" must be a number`);
    if (command.stdout !== undefined && typeof command.stdout !== "string") throw dataShapeError("CommandEvidence", "commandEvidenceData", "CommandEvidenceContent", `"data.commands[${index}].stdout" must be a string`);
    if (command.stderr !== undefined && typeof command.stderr !== "string") throw dataShapeError("CommandEvidence", "commandEvidenceData", "CommandEvidenceContent", `"data.commands[${index}].stderr" must be a string`);
  }
  return data as unknown as CommandEvidenceContent;
}

export type CommandEvidenceProps = ValueProps<
  CommandEvidenceContent | null,
  { locale?: ReportLocale; className?: string }
>;

export const CommandEvidence = defineComponent<CommandEvidenceProps, { data: CommandEvidenceContent | null; className?: string }>({
  dimensions: () => ({}),
  resolve(props) {
    return { data: props.data ?? null, className: props.className };
  },
  web({ data, className }, ctx) {
    const content = assertCommandEvidenceContent(data);
    if (content === null || content.commands.length === 0) return null;
    return (
      <section className={cx("niceeval-report", "niceeval-command-evidence", className)}>
        <details className="niceeval-command-evidence-region">
          <summary className="niceeval-command-evidence-summary">
            {resolveLocalizedText(
              { en: `Commands · ${content.commands.length}`, "zh-CN": `命令证据 · ${content.commands.length}` },
              ctx.locale,
            )}
          </summary>
          <div className="niceeval-command-evidence-cards">
            {content.commands.map((command) => <CommandEvidenceCard key={command.key} command={command} />)}
          </div>
        </details>
      </section>
    );
  },
  text({ data }) {
    const content = assertCommandEvidenceContent(data);
    if (content === null || content.commands.length === 0) return "";
    const lines = [`commands: ${content.commands.length}`];
    for (const command of content.commands) {
      lines.push(`  ${commandEvidenceTitle(command)}`);
      lines.push(`    ${command.display}`);
      if (command.stdout) lines.push(`    stdout\n      ${command.stdout.replace(/\n/g, "\n      ")}`);
      if (command.stderr) lines.push(`    stderr\n      ${command.stderr.replace(/\n/g, "\n      ")}`);
    }
    return lines.join("\n");
  },
});
CommandEvidence.displayName = "CommandEvidence";

export const Conversation = defineComponent<ConversationProps, ResolvedConversationProps>({
  dimensions: () => ({}),
  resolve(props) {
    return {
      data: props.data ?? null,
      drillDown: undefined,
      locale: props.locale,
      className: props.className,
    };
  },
  web({ data, className, locale }, ctx) {
    const content = assertConversationContent(data);
    if (isEmptyConversation(content)) return null;
    const loc = locale ?? ctx.locale;
    return (
      <div className={cx("niceeval-report", "niceeval-conversation", className)}>
        {content!.turns.map((turn) => (
          <TurnCard key={turn.key} turn={turn} locale={loc} />
        ))}
      </div>
    );
  },
  text({ data, drillDown, locale }, ctx) {
    const content = assertConversationContent(data);
    if (isEmptyConversation(content)) return "";
    return conversationText(content!, ctx, locale ?? ctx.locale, drillDown);
  },
});
Conversation.displayName = "Conversation";
