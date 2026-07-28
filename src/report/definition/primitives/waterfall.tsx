// Waterfall 原语:时间树与瀑布,runner 阶段树 / 原始 span 树 / 范围级 attempt 瀑布共用
// 这一形状(docs/feature/reports/components/primitives/waterfall.md)。通用呈现从
// TraceWaterfall、AttemptTrace、AttemptTimeline 抽出;专用件在 1.7 前保留。

import type { ReactElement, ReactNode } from "react";
import type { AttemptLocator } from "../../../record/locator.ts";
import { defineComponent, type TextContext } from "../tree.ts";
import { countText, resolveLocalizedText, type LocalizedText, type ReportLocale } from "../../model/locale.ts";
import { formatDurationMs } from "../../model/format.ts";
import type { Source, SourceInput } from "../../source.ts";

function cx(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** `null` / 测不了的时长统一显示符;不折成 0。 */
const MISSING_MARK = "—";

export interface WaterfallNode {
  key: string;
  label: LocalizedText;
  kind: string;
  startOffsetMs: number;
  durationMs: number | null;
  failed?: boolean;
  children?: readonly WaterfallNode[];
}

export interface WaterfallRow {
  key: string;
  label: LocalizedText;
  durationMs: number | null;
  nodes: readonly WaterfallNode[];
  locator?: AttemptLocator;
}

export type WaterfallContent = readonly WaterfallRow[];

export type WaterfallProps<Input extends SourceInput = SourceInput> =
  | ({
      data: WaterfallContent | null;
      source?: never;
      input?: never;
      attemptHref?: (locator: AttemptLocator) => string;
      locale?: ReportLocale;
      className?: string;
    })
  | ({
      source: Source<Input, WaterfallContent | null>;
      data?: never;
      input?: Input;
      attemptHref?: (locator: AttemptLocator) => string;
      locale?: ReportLocale;
      className?: string;
    });

function pct(part: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.min(100, Math.max(0, (part / total) * 100)).toFixed(2)}%`;
}

function formatDurationOrMissing(ms: number | null): string {
  return ms === null ? MISSING_MARK : formatDurationMs(ms);
}

function countNodes(nodes: readonly WaterfallNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children ?? []), 0);
}

function countFailed(nodes: readonly WaterfallNode[]): number {
  return nodes.reduce((sum, node) => sum + (node.failed ? 1 : 0) + countFailed(node.children ?? []), 0);
}

function WaterfallNodeRow({
  node,
  locale,
}: {
  node: WaterfallNode;
  locale: ReportLocale;
}): ReactElement {
  const label = resolveLocalizedText(node.label, locale);
  const kids = node.children ?? [];
  const body = (
    <>
      <span className={cx("niceeval-waterfall-node-kind", `niceeval-span-${node.kind}`)}>{node.kind}</span>
      <span title={label}>{label}</span>
      <span className="niceeval-waterfall-node-dur">{formatDurationOrMissing(node.durationMs)}</span>
      {node.failed ? <span className="niceeval-waterfall-node-failed"> ✗</span> : null}
    </>
  );
  if (kids.length === 0) {
    return (
      <li className={cx("niceeval-waterfall-node", node.failed && "niceeval-waterfall-node--failed")}>{body}</li>
    );
  }
  return (
    <li>
      <details open={Boolean(node.failed)}>
        <summary className={cx("niceeval-waterfall-node", node.failed && "niceeval-waterfall-node--failed")}>{body}</summary>
        <ul className="niceeval-waterfall-node-children">
          {kids.map((child) => (
            <WaterfallNodeRow key={child.key} node={child} locale={locale} />
          ))}
        </ul>
      </details>
    </li>
  );
}

function renderWaterfallWeb(
  rows: WaterfallContent,
  locale: ReportLocale,
  attemptHref: ((locator: AttemptLocator) => string) | undefined,
  className?: string,
): ReactNode {
  return (
    <section className={cx("niceeval-report", "niceeval-waterfall", className)}>
      <ul className="niceeval-waterfall-list">
        {rows.map((row) => {
          const totalNodes = countNodes(row.nodes);
          const failedNodes = countFailed(row.nodes);
          const label = resolveLocalizedText(row.label, locale);
          return (
            <li key={row.key} className="niceeval-waterfall-row">
              <div className="niceeval-waterfall-head">
                {row.locator !== undefined ? (
                  attemptHref ? (
                    <a className="niceeval-locator" href={attemptHref(row.locator)}>
                      {row.locator}
                    </a>
                  ) : (
                    <span className="niceeval-locator">{row.locator}</span>
                  )
                ) : null}
                <span className="niceeval-waterfall-label">{label}</span>
                <span className="niceeval-waterfall-duration">{formatDurationOrMissing(row.durationMs)}</span>
                <span className="niceeval-waterfall-count">{countText(locale, "waterfall.nodes", totalNodes)}</span>
                {failedNodes > 0 ? (
                  <span className="niceeval-waterfall-failed">
                    ✗ {countText(locale, "waterfall.failedNodes", failedNodes)}
                  </span>
                ) : null}
              </div>
              {row.durationMs !== null && row.nodes.some((node) => node.durationMs !== null) ? (
                <div className="niceeval-waterfall-track">
                  {row.nodes.map((node) =>
                    node.durationMs === null ? null : (
                      <span
                        key={node.key}
                        className={cx(
                          "niceeval-waterfall-bar",
                          `niceeval-span-${node.kind}`,
                          node.failed && "niceeval-span-failed",
                        )}
                        style={{
                          left: pct(node.startOffsetMs, row.durationMs!),
                          width: `max(${pct(node.durationMs, row.durationMs!)}, 0.5%)`,
                        }}
                        title={`${resolveLocalizedText(node.label, locale)} · ${formatDurationMs(node.durationMs)}${node.failed ? " · ✗" : ""}`}
                      />
                    ),
                  )}
                </div>
              ) : null}
              {row.nodes.length > 0 ? (
                <ul className="niceeval-waterfall-nodes">
                  {row.nodes.map((node) => (
                    <WaterfallNodeRow key={node.key} node={node} locale={locale} />
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function waterfallText(rows: WaterfallContent, ctx: TextContext): string {
  return rows
    .map((row) => {
      const totalNodes = countNodes(row.nodes);
      const failedNodes = countFailed(row.nodes);
      const parts = [
        resolveLocalizedText(row.label, ctx.locale),
        formatDurationOrMissing(row.durationMs),
        countText(ctx.locale, "waterfall.nodes", totalNodes),
        ...(failedNodes > 0 ? [`✗ ${countText(ctx.locale, "waterfall.failedNodes", failedNodes)}`] : []),
      ];
      const line = parts.join(" · ");
      return row.locator !== undefined && ctx.attemptCommand
        ? `${line}   ${ctx.attemptCommand(row.locator)}`
        : line;
    })
    .join("\n");
}

/** 时间树与瀑布:一批带起止偏移的节点,可逐层展开。 */
export const Waterfall = defineComponent<WaterfallProps>({
  dimensions: () => ({}),
  web(props, ctx) {
    const content = props.data ?? null;
    if (content === null || content.length === 0) return null;
    const locale = props.locale ?? ctx.locale;
    const attemptHref = props.attemptHref ?? ctx.attemptHref;
    return renderWaterfallWeb(content, locale, attemptHref, props.className);
  },
  text(props, ctx) {
    const content = props.data ?? null;
    if (content === null || content.length === 0) return "";
    return waterfallText(content, { ...ctx, locale: props.locale ?? ctx.locale });
  },
});
Waterfall.displayName = "Waterfall";
