// SourceView:GitHub diff 式带标注源码(docs/feature/reports/library.md)。
// 只消费已投影的 SourceContent；不读磁盘、不分桶。视觉规范与 AttemptSource 同语言、实现独立。

import { createElement, Fragment, type ReactElement, type ReactNode } from "react";
import type { AttemptLocator } from "../../../attempt-locator.ts";
import {
  defineComponent,
  type ReportNode,
  type TextContext,
} from "../tree.ts";
import { resolveLocalizedText, type LocalizedText, type ReportLocale } from "../../model/locale.ts";
import {
  attemptPageTarget,
  dataShapeError,
  isLocalizedText,
  isObject,
  type ValueProps,
} from "./shared.ts";

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

export type SourceViewProps = ValueProps<
  SourceContent | null,
  { locale?: ReportLocale; className?: string }
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

/** 前置中止行按 gate-fail 呈现(attempt-source.md「行状态」),其余行取自身 tone。 */
function lineTone(line: SourceLine): SourceLineTone | undefined {
  return line.aborted ? "gate-fail" : line.tone;
}

function toneClass(tone: SourceLineTone | undefined): string | undefined {
  if (!tone) return undefined;
  return `niceeval-source-line--${tone}`;
}

/** 行号位标记:内联 SVG,零图标依赖(attempt-source.md「行状态」)。 */
const MARK_ICONS: Record<SourceLineTone, ReactElement> = {
  send: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />,
  passed: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  "gate-fail": (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </>
  ),
  "soft-fail": (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </>
  ),
  unavailable: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </>
  ),
};

const MARK_LABELS: Record<SourceLineTone, string> = {
  send: "send",
  passed: "passed",
  "gate-fail": "failed",
  "soft-fail": "soft failed",
  unavailable: "unavailable",
};

/** 行号位:普通行显示行号,有状态的行用标记图标顶替行号。 */
function Gutter({ line }: { line: SourceLine }): ReactElement {
  const tone = lineTone(line);
  if (tone === undefined) return <span className="niceeval-source-gutter">{line.number}</span>;
  return (
    <span
      className="niceeval-source-gutter niceeval-source-gutter-mark"
      role="img"
      aria-label={MARK_LABELS[tone]}
      title={MARK_LABELS[tone]}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {MARK_ICONS[tone]}
      </svg>
    </span>
  );
}

function LineSummary({ line, locale }: { line: SourceLine; locale: ReportLocale }): ReactElement {
  return (
    <span className="niceeval-source-line-summary">
      <Gutter line={line} />
      <span className="niceeval-source-code">{line.text}</span>
      <span className="niceeval-source-meta">
        {line.pill !== undefined ? (
          <span className="niceeval-source-pill">{resolveLocalizedText(line.pill, locale)}</span>
        ) : null}
        {line.aborted ? (
          <span className="niceeval-source-abort-mark" aria-hidden="true">
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
    <div className="niceeval-source-calls">
      {calls.map((call, i) => (
        <details key={i} className={cx("niceeval-source-call", call.tone && `niceeval-source-call--${call.tone}`)} open={call.open}>
          <summary>{resolveLocalizedText(call.summary, locale)}</summary>
          {call.target.kind === "opaque" ? (
            <div className="niceeval-source-opaque">
              <div className="niceeval-source-opaque-label">{resolveLocalizedText(call.target.label, locale)}</div>
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
    <div className={cx("niceeval-source-block", nested && "niceeval-source-block--nested")}>
      <div className="niceeval-source-block-path">{block.path}</div>
      <div className="niceeval-source-lines">
        {block.lines.map((line) => {
          const unreached = afterAbort;
          if (line.aborted) afterAbort = true;
          const interactive =
            (line.details !== undefined && line.details.length > 0) ||
            (line.calls !== undefined && line.calls.length > 0);
          const lineClass = cx(
            "niceeval-source-line",
            toneClass(lineTone(line)),
            unreached && "niceeval-source-line-unreached",
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
              <div className="niceeval-source-line-detail">
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
  const command = data.locator !== undefined ? ctx.command(attemptPageTarget(data.locator)) : undefined;
  if (command !== undefined) {
    lines.push("");
    lines.push(command);
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
      <div className={cx("niceeval-report", "niceeval-source-view", props.className)}>
        <SourceBlock block={data.spine} locale={locale} renderChild={renderChild} />
        {data.detached.map((block) => (
          <SourceBlock key={block.path} block={block} locale={locale} renderChild={renderChild} />
        ))}
        {data.unmapped && data.unmapped.length > 0 ? (
          <div className="niceeval-source-unmapped">
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
