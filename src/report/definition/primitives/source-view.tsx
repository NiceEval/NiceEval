// SourceView:GitHub diff 式带标注源码(docs/feature/reports/components/primitives/source-view.md)。
// 只消费已投影的 SourceContent；不读磁盘、不分桶。视觉规范与 AttemptSource 同语言、实现独立。

import { createElement, Fragment, type ReactElement, type ReactNode } from "react";
import type { AttemptLocator } from "../../../record/locator.ts";
import type { SourceInput } from "../../source.ts";
import {
  defineComponent,
  type ReportNode,
  type TextContext,
} from "../tree.ts";
import { resolveLocalizedText, type LocalizedText, type ReportLocale } from "../../model/locale.ts";
import {
  dataShapeError,
  isLocalizedText,
  isObject,
  type DataProps,
} from "../../components/shared.ts";

export type SourceLineTone = "send" | "passed" | "gate-fail" | "soft-fail" | "unavailable";

export interface SourceLine {
  number: number;
  text: string;
  tone?: SourceLineTone;
  pill?: LocalizedText;
  aborted?: boolean;
  details?: readonly ReportNode[];
  calls?: readonly SourceCallContent[];
}

export interface SourceBlockContent {
  path: string;
  lines: readonly SourceLine[];
}

export interface SourceCallContent {
  summary: LocalizedText;
  tone?: "passed" | "gate-fail" | "soft-fail" | "unavailable";
  open: boolean;
  target:
    | { kind: "source"; block: SourceBlockContent }
    | { kind: "opaque"; label: LocalizedText; calls?: readonly SourceCallContent[] };
}

export interface SourceContent {
  spine: SourceBlockContent;
  detached: readonly SourceBlockContent[];
  unmapped?: readonly ReportNode[];
  locator?: AttemptLocator;
}

export type SourceViewProps<Input extends SourceInput = SourceInput> = DataProps<
  SourceContent | null,
  globalThis.Record<never, never>,
  { locale?: ReportLocale; className?: string },
  Input
>;

function cx(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(" ");
}

const REACT_FRAGMENT = Symbol.for("react.fragment");

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

const TS_HL_RE =
  /(\/\/[^\n]*)|(\/\*[^]*?\*\/)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(import|from|export|default|const|let|var|async|await|function|return|if|else|for|of|in|new|class|extends|typeof|void|true|false|null|undefined)\b|\b(\d[\d_.]*)\b|([A-Za-z_$][\w$]*)(?=\s*\()/g;

function highlightTs(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let match: RegExpExecArray | null;
  TS_HL_RE.lastIndex = 0;
  while ((match = TS_HL_RE.exec(line))) {
    if (match.index > last) out.push(line.slice(last, match.index));
    const tokenClass =
      match[1] || match[2] ? "tok-comment" : match[3] ? "tok-str" : match[4] ? "tok-kw" : match[5] ? "tok-num" : "tok-fn";
    out.push(
      <span key={i++} className={tokenClass}>
        {match[0]}
      </span>,
    );
    last = match.index + match[0].length;
    if (match[0].length === 0) TS_HL_RE.lastIndex++;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

function validateBlock(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an object`;
  if (typeof value.path !== "string") return `"${path}.path" must be a string`;
  if (!Array.isArray(value.lines)) return `"${path}.lines" must be an array`;
  for (let i = 0; i < value.lines.length; i++) {
    const line = value.lines[i];
    if (!isObject(line)) return `"${path}.lines[${i}]" must be an object`;
    if (typeof line.number !== "number") return `"${path}.lines[${i}].number" must be a number`;
    if (typeof line.text !== "string") return `"${path}.lines[${i}].text" must be a string`;
    if (line.pill !== undefined && !isLocalizedText(line.pill)) {
      return `"${path}.lines[${i}].pill" must be a LocalizedText`;
    }
  }
  return null;
}

function assertSourceContent(data: unknown): SourceContent | null {
  if (data === null || data === undefined) return null;
  if (!isObject(data)) {
    throw dataShapeError("SourceView", "sourceViewData", "SourceContent", '"data" must be an object or null');
  }
  const spineProblem = validateBlock(data.spine, "data.spine");
  if (spineProblem !== null) throw dataShapeError("SourceView", "sourceViewData", "SourceContent", spineProblem);
  if (!Array.isArray(data.detached)) {
    throw dataShapeError("SourceView", "sourceViewData", "SourceContent", '"data.detached" must be an array');
  }
  for (let i = 0; i < data.detached.length; i++) {
    const problem = validateBlock(data.detached[i], `data.detached[${i}]`);
    if (problem !== null) throw dataShapeError("SourceView", "sourceViewData", "SourceContent", problem);
  }
  return data as unknown as SourceContent;
}

function toneClass(tone: SourceLineTone | undefined): string | undefined {
  if (!tone) return undefined;
  return `nre-source-line--${tone}`;
}

function LineSummary({ line, locale }: { line: SourceLine; locale: ReportLocale }): ReactElement {
  return (
    <span className="nre-source-line-summary">
      <span className="nre-source-gutter">{line.tone ? "" : line.number}</span>
      <span className="nre-source-code">{highlightTs(line.text)}</span>
      <span className="nre-source-meta">
        {line.pill !== undefined ? (
          <span className="nre-source-pill">{resolveLocalizedText(line.pill, locale)}</span>
        ) : null}
        {line.aborted ? (
          <span className="nre-source-abort-mark" aria-hidden="true">
            ⤓
          </span>
        ) : null}
      </span>
    </span>
  );
}

function CallTree({
  calls,
  locale,
  renderChild,
}: {
  calls: readonly SourceCallContent[];
  locale: ReportLocale;
  renderChild: (node: ReportNode) => ReactNode;
}): ReactElement {
  return (
    <div className="nre-source-calls">
      {calls.map((call, i) => (
        <details key={i} className={cx("nre-source-call", call.tone && `nre-source-call--${call.tone}`)} open={call.open}>
          <summary>{resolveLocalizedText(call.summary, locale)}</summary>
          {call.target.kind === "opaque" ? (
            <div className="nre-source-opaque">
              <div className="nre-source-opaque-label">{resolveLocalizedText(call.target.label, locale)}</div>
              {call.target.calls ? (
                <CallTree calls={call.target.calls} locale={locale} renderChild={renderChild} />
              ) : null}
            </div>
          ) : (
            <SourceBlock block={call.target.block} locale={locale} renderChild={renderChild} nested />
          )}
        </details>
      ))}
    </div>
  );
}

function SourceBlock({
  block,
  locale,
  renderChild,
  nested = false,
}: {
  block: SourceBlockContent;
  locale: ReportLocale;
  renderChild: (node: ReportNode) => ReactNode;
  nested?: boolean;
}): ReactElement {
  const firstAttention = block.lines.find(
    (line) => line.tone === "gate-fail" || line.tone === "soft-fail" || line.tone === "unavailable",
  )?.number;
  let afterAbort = false;
  return (
    <div className={cx("nre-source-block", nested && "nre-source-block--nested")}>
      <div className="nre-source-block-path">{block.path}</div>
      <div className="nre-source-lines">
        {block.lines.map((line) => {
          const unreached = afterAbort;
          if (line.aborted) afterAbort = true;
          const interactive =
            (line.details !== undefined && line.details.length > 0) ||
            (line.calls !== undefined && line.calls.length > 0);
          const lineClass = cx(
            "nre-source-line",
            toneClass(line.tone),
            unreached && "nre-source-line-unreached",
          );
          if (!interactive) {
            return (
              <div key={line.number} className={lineClass}>
                <LineSummary line={line} locale={locale} />
              </div>
            );
          }
          return (
            <details key={line.number} className={lineClass} open={line.number === firstAttention}>
              <summary>
                <LineSummary line={line} locale={locale} />
              </summary>
              <div className="nre-source-line-detail">
                {line.details?.map((detail, i) => (
                  <div key={i}>{renderChild(detail)}</div>
                ))}
                {line.calls ? <CallTree calls={line.calls} locale={locale} renderChild={renderChild} /> : null}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

export function sourceViewText(data: SourceContent, ctx: TextContext, locale: ReportLocale): string {
  const lines: string[] = [];
  const collect = (block: SourceBlockContent) => {
    for (const line of block.lines) {
      if (!line.tone && !line.aborted) continue;
      const pill = line.pill !== undefined ? ` ${resolveLocalizedText(line.pill, locale)}` : "";
      lines.push(`${block.path}:${line.number} [${line.tone ?? "aborted"}]${pill}`);
    }
  };
  collect(data.spine);
  for (const block of data.detached) collect(block);
  if (data.unmapped && data.unmapped.length > 0) {
    lines.push(`unmapped: ${data.unmapped.length}`);
  }
  if (data.locator !== undefined && ctx.attemptCommand) {
    lines.push("");
    lines.push(ctx.attemptCommand(data.locator));
  }
  return lines.join("\n");
}

export const SourceView = defineComponent<SourceViewProps>({
  dimensions: () => ({}),
  web(props, ctx) {
    const data = assertSourceContent(props.data ?? null);
    if (data === null) return null;
    const locale = props.locale ?? ctx.locale;
    const renderChild = renderReportNode;
    return (
      <div className={cx("nre", "nre-source-view", props.className)}>
        <SourceBlock block={data.spine} locale={locale} renderChild={renderChild} />
        {data.detached.map((block) => (
          <SourceBlock key={block.path} block={block} locale={locale} renderChild={renderChild} />
        ))}
        {data.unmapped && data.unmapped.length > 0 ? (
          <div className="nre-source-unmapped">
            {data.unmapped.map((node, i) => (
              <div key={i}>{renderChild(node)}</div>
            ))}
          </div>
        ) : null}
      </div>
    );
  },
  text(props, ctx) {
    const data = assertSourceContent(props.data ?? null);
    if (data === null) return "";
    return sourceViewText(data, ctx, props.locale ?? ctx.locale);
  },
});
SourceView.displayName = "SourceView";
