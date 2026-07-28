// Waterfall 原语:时间树与瀑布,runner 阶段树 / 原始 span 树 / 范围级 attempt 瀑布共用
// 这一形状(docs/feature/reports/components/primitives/waterfall.md)。通用呈现从
// TraceWaterfall、AttemptTrace、AttemptTimeline 抽出;专用件在 1.7 前保留。

import type { ReactElement, ReactNode } from "react";
import type { AttemptLocator } from "../../../record/locator.ts";
import { defineComponent, type TextContext } from "../tree.ts";
import { countText, localeText, resolveLocalizedText, type LocalizedText, type ReportLocale } from "../../model/locale.ts";
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
  /** 数据源标记的主干节点:默认展开且不参与显著性折叠(失败节点恒展开)。 */
  open?: boolean;
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
      /** 区块标题;Content 为 null 或空时整块(含标题)不渲染。 */
      title?: LocalizedText;
      attemptHref?: (locator: AttemptLocator) => string;
      locale?: ReportLocale;
      className?: string;
    })
  | ({
      source: Source<Input, WaterfallContent | null>;
      data?: never;
      input?: Input;
      /** 区块标题;Content 为 null 或空时整块(含标题)不渲染。 */
      title?: LocalizedText;
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

/** 显著性折叠的占比阈值:低于行总时长 1% 且不失败、时长可测的节点折成摘要
 *  (docs/feature/reports/components/primitives/waterfall.md「显著性折叠」)。 */
const FOLD_SHARE = 0.01;

type WaterfallListItem =
  | { kind: "node"; node: WaterfallNode }
  | { kind: "fold"; nodes: WaterfallNode[] };

function isSalient(node: WaterfallNode, rowDurationMs: number): boolean {
  return (
    Boolean(node.failed) ||
    Boolean(node.open) ||
    node.durationMs === null ||
    node.durationMs >= rowDurationMs * FOLD_SHARE
  );
}

/** 同层兄弟清单按显著性折叠;行总时长缺失时没有占比基准,整层不折。 */
function foldSiblings(nodes: readonly WaterfallNode[], rowDurationMs: number | null): WaterfallListItem[] {
  if (rowDurationMs === null || rowDurationMs <= 0) {
    return nodes.map((node) => ({ kind: "node", node }));
  }
  const items: WaterfallListItem[] = [];
  for (const node of nodes) {
    if (isSalient(node, rowDurationMs)) {
      items.push({ kind: "node", node });
      continue;
    }
    const last = items[items.length - 1];
    if (last !== undefined && last.kind === "fold") last.nodes.push(node);
    else items.push({ kind: "fold", nodes: [node] });
  }
  return items;
}

/** 摘要行文案:`tool ×5 · 合计 218ms`;被折节点时长恒非 null(null 是显著判据)。 */
function foldLabel(nodes: readonly WaterfallNode[], locale: ReportLocale): string {
  const counts = new Map<string, number>();
  for (const node of nodes) counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
  const kinds = [...counts.entries()].map(([kind, n]) => `${kind} ×${n}`).join(" · ");
  const totalMs = nodes.reduce((sum, node) => sum + (node.durationMs ?? 0), 0);
  return `${kinds} · ${localeText(locale, "waterfall.foldTotal", { t: formatDurationMs(totalMs) })}`;
}

function WaterfallNodeList({
  nodes,
  locale,
  rowDurationMs,
  className = "niceeval-waterfall-nodes",
}: {
  nodes: readonly WaterfallNode[];
  locale: ReportLocale;
  rowDurationMs: number | null;
  className?: string;
}): ReactElement {
  return (
    <ul className={className}>
      {foldSiblings(nodes, rowDurationMs).map((item) =>
        item.kind === "node" ? (
          <WaterfallNodeRow key={item.node.key} node={item.node} locale={locale} rowDurationMs={rowDurationMs} />
        ) : (
          <li key={`fold:${item.nodes[0]!.key}`}>
            <details className="niceeval-waterfall-fold">
              <summary className="niceeval-waterfall-node niceeval-waterfall-fold-summary">
                {foldLabel(item.nodes, locale)}
              </summary>
              <ul className="niceeval-waterfall-node-children">
                {item.nodes.map((node) => (
                  <WaterfallNodeRow key={node.key} node={node} locale={locale} rowDurationMs={rowDurationMs} />
                ))}
              </ul>
            </details>
          </li>
        ),
      )}
    </ul>
  );
}

function WaterfallNodeRow({
  node,
  locale,
  rowDurationMs,
}: {
  node: WaterfallNode;
  locale: ReportLocale;
  rowDurationMs: number | null;
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
      <details open={Boolean(node.failed) || Boolean(node.open)}>
        <summary className={cx("niceeval-waterfall-node", node.failed && "niceeval-waterfall-node--failed")}>{body}</summary>
        <WaterfallNodeList
          nodes={kids}
          locale={locale}
          rowDurationMs={rowDurationMs}
          className="niceeval-waterfall-node-children"
        />
      </details>
    </li>
  );
}

function renderWaterfallWeb(
  rows: WaterfallContent,
  locale: ReportLocale,
  attemptHref: ((locator: AttemptLocator) => string) | undefined,
  title?: LocalizedText,
  className?: string,
): ReactNode {
  return (
    <section className={cx("niceeval-report", "niceeval-waterfall", className)}>
      {title !== undefined ? (
        <div className="niceeval-waterfall-title">{resolveLocalizedText(title, locale)}</div>
      ) : null}
      <ul className="niceeval-waterfall-list">
        {rows.map((row) => {
          const totalNodes = countNodes(row.nodes);
          const failedNodes = countFailed(row.nodes);
          const label = resolveLocalizedText(row.label, locale);
          // label 与 locator 同文时只画 locator 一次(waterfall.md「渲染」)。
          const labelRepeatsLocator = row.locator !== undefined && label === String(row.locator);
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
                {labelRepeatsLocator ? null : <span className="niceeval-waterfall-label">{label}</span>}
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
                <WaterfallNodeList nodes={row.nodes} locale={locale} rowDurationMs={row.durationMs} />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function waterfallText(rows: WaterfallContent, ctx: TextContext, title?: LocalizedText): string {
  const lines = rows
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
  return title !== undefined ? `${resolveLocalizedText(title, ctx.locale)}\n${lines}` : lines;
}

/** 时间树与瀑布:一批带起止偏移的节点,可逐层展开。 */
export const Waterfall = defineComponent<WaterfallProps>({
  dimensions: () => ({}),
  web(props, ctx) {
    const content = props.data ?? null;
    if (content === null || content.length === 0) return null;
    const locale = props.locale ?? ctx.locale;
    const attemptHref = props.attemptHref ?? ctx.attemptHref;
    return renderWaterfallWeb(content, locale, attemptHref, props.title, props.className);
  },
  text(props, ctx) {
    const content = props.data ?? null;
    if (content === null || content.length === 0) return "";
    return waterfallText(content, { ...ctx, locale: props.locale ?? ctx.locale }, props.title);
  },
});
Waterfall.displayName = "Waterfall";
