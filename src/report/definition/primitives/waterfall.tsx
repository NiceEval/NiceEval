// Waterfall 原语:时间树与瀑布,runner 阶段树 / 原始 span 树 / 范围级 attempt 瀑布共用
// 这一形状(docs/feature/reports/components/primitives/waterfall.md)。通用呈现从
// TraceWaterfall、AttemptTrace、AttemptTimeline 抽出;专用件在 1.7 前保留。

import type { ReactElement, ReactNode } from "react";
import type { AttemptLocator } from "../../../record/locator.ts";
import { defineComponent, type TextContext, type WebContext } from "../tree.ts";
import { ATTEMPT_PAGE_ID, hrefForLocator } from "../../components/shared.ts";
import { countText, localeText, resolveLocalizedText, type LocalizedText, type ReportLocale } from "../../model/locale.ts";
import { formatDurationMs } from "../../model/format.ts";

function cx(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** `null` / 测不了的时长统一显示符;不折成 0。 */
const MISSING_MARK = "—";

export interface WaterfallNode {
  key: string;
  label: LocalizedText;
  /** 节点类别;清单里占一列,条上决定分类色。词表由数据源给,原语不建注册表。 */
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

export interface WaterfallProps {
  /** 多 attempt 行为 WaterfallRow[]；单树可包成一行。 */
  nodes: WaterfallContent | null;
  /** 区块标题;Content 为 null 或空时整块(含标题)不渲染。 */
  title?: LocalizedText;
  locale?: ReportLocale;
  className?: string;
}
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

/** 分解条画的那一批:树里没有 children 的节点,递归取
 *  (docs/feature/reports/components/primitives/waterfall.md「分解条画哪些节点」)。
 *  父节点在时间上包住子节点,一起画只会盖住子段。 */
function leafNodes(nodes: readonly WaterfallNode[], out: WaterfallNode[] = []): WaterfallNode[] {
  for (const node of nodes) {
    const kids = node.children ?? [];
    if (kids.length === 0) out.push(node);
    else leafNodes(kids, out);
  }
  return out;
}

/** 条上分类色的槽数:分类色板六槽里避开与 negative 最近的那一槽,失败段才分得出来
 *  (docs/feature/reports/components/primitives/waterfall.md「类别与着色」)。 */
const KIND_SLOTS = 5;

/** kind 字面稳定散列到分类色槽:原语不认词表,新词也有槽,同一个词恒同槽。 */
function kindSlot(kind: string): number {
  let hash = 0;
  for (let i = 0; i < kind.length; i++) hash = (Math.imul(hash, 31) + kind.charCodeAt(i)) >>> 0;
  return hash % KIND_SLOTS;
}

function countFailed(nodes: readonly WaterfallNode[]): number {
  return nodes.reduce((sum, node) => sum + (node.failed ? 1 : 0) + countFailed(node.children ?? []), 0);
}

/** 显著性折叠的占比阈值:低于行总时长 1% 且不失败、时长可测的节点折成摘要
 *  (docs/feature/reports/components/primitives/waterfall.md「显著性折叠」)。 */
const FOLD_SHARE = 0.01;

/** 重复摘要的起折条数:两条相邻的同名节点摊开读得动,摘要行反而多要一次展开。 */
const REPEAT_MIN = 3;

/** 短节点摘要的起折条数:只折一条时摘要与节点各占一行,省不下高度却把名字换成了计数。 */
const SHORT_MIN = 2;

type WaterfallListItem =
  | { kind: "node"; node: WaterfallNode }
  | { kind: "fold"; nodes: WaterfallNode[] }
  | { kind: "repeat"; nodes: WaterfallNode[] };

function isSalient(node: WaterfallNode, rowDurationMs: number): boolean {
  return (
    Boolean(node.failed) ||
    Boolean(node.open) ||
    node.durationMs === null ||
    node.durationMs >= rowDurationMs * FOLD_SHARE
  );
}

/** 短节点与重复节点两条判据共用的豁免:失败、主干与测不出时长的节点恒逐条列出。 */
function isFoldable(node: WaterfallNode): boolean {
  return !node.failed && !node.open && node.durationMs !== null;
}

/** 显著性折叠:连续的非显著节点进一条摘要;行总时长缺失时没有占比基准,整层不折。 */
function foldShort(nodes: readonly WaterfallNode[], rowDurationMs: number | null): WaterfallListItem[] {
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
  return items.map((item) =>
    item.kind === "fold" && item.nodes.length < SHORT_MIN ? { kind: "node", node: item.nodes[0]! } : item,
  );
}

/** 重复折叠:连续、同 kind、label 同文的节点满 REPEAT_MIN 条起折成一条。
 *  短节点那条规则收不住它们——它们不短,只是同一句话说了几十遍。 */
function foldRepeats(items: readonly WaterfallListItem[], locale: ReportLocale): WaterfallListItem[] {
  const out: WaterfallListItem[] = [];
  let run: WaterfallNode[] = [];
  let runKey: string | null = null;
  const flush = (): void => {
    if (run.length >= REPEAT_MIN) out.push({ kind: "repeat", nodes: run });
    else for (const node of run) out.push({ kind: "node", node });
    run = [];
    runKey = null;
  };
  for (const item of items) {
    if (item.kind === "node" && isFoldable(item.node)) {
      const key = `${item.node.kind}\u0000${resolveLocalizedText(item.node.label, locale)}`;
      if (key !== runKey) flush();
      runKey = key;
      run.push(item.node);
      continue;
    }
    // 异名节点(与短节点摘要)切断连续段:两种摘要各自成行,不合并。
    flush();
    out.push(item);
  }
  flush();
  return out;
}

/** 同层兄弟清单依次过两条收敛规则。 */
function foldSiblings(
  nodes: readonly WaterfallNode[],
  rowDurationMs: number | null,
  locale: ReportLocale,
): WaterfallListItem[] {
  return foldRepeats(foldShort(nodes, rowDurationMs), locale);
}

/** 短节点摘要的名字列:`tool ×4 · model ×1`。 */
function shortFoldLabel(nodes: readonly WaterfallNode[]): string {
  const counts = new Map<string, number>();
  for (const node of nodes) counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
  return [...counts.entries()].map(([kind, n]) => `${kind} ×${n}`).join(" · ");
}

/** 重复摘要的名字列:`model_client.stream_responses ×24`。 */
function repeatFoldLabel(nodes: readonly WaterfallNode[], locale: ReportLocale): string {
  return `${resolveLocalizedText(nodes[0]!.label, locale)} ×${nodes.length}`;
}

/** 两种摘要共用的时长列:`合计 4m 3s`;被折节点时长恒非 null(缺失是豁免判据)。 */
function foldTotal(nodes: readonly WaterfallNode[], locale: ReportLocale): string {
  const totalMs = nodes.reduce((sum, node) => sum + (node.durationMs ?? 0), 0);
  return localeText(locale, "waterfall.foldTotal", { t: formatDurationMs(totalMs) });
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
      {foldSiblings(nodes, rowDurationMs, locale).map((item) =>
        item.kind === "node" ? (
          <WaterfallNodeRow key={item.node.key} node={item.node} locale={locale} rowDurationMs={rowDurationMs} />
        ) : (
          <li key={`${item.kind}:${item.nodes[0]!.key}`}>
            <details className="niceeval-waterfall-fold">
              <summary className="niceeval-waterfall-node niceeval-waterfall-fold-summary">
                <span className="niceeval-waterfall-node-name">
                  {item.kind === "fold" ? shortFoldLabel(item.nodes) : repeatFoldLabel(item.nodes, locale)}
                </span>
                <span className="niceeval-waterfall-node-dur">{foldTotal(item.nodes, locale)}</span>
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
  // 三列:类别、名字、时长。类别列不着色——着色是条上的事(waterfall.md「类别与着色」)。
  const body = (
    <>
      <span className="niceeval-waterfall-node-kind">{node.kind}</span>
      <span className="niceeval-waterfall-node-name" title={label}>
        {label}
      </span>
      {node.failed ? <span className="niceeval-waterfall-node-failed">✗</span> : null}
      <span className="niceeval-waterfall-node-dur">{formatDurationOrMissing(node.durationMs)}</span>
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
  ctx: WebContext,
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
          const leaves = leafNodes(row.nodes);
          const label = resolveLocalizedText(row.label, locale);
          // label 与 locator 同文时只画 locator 一次(waterfall.md「渲染」)。
          const labelRepeatsLocator = row.locator !== undefined && label === String(row.locator);
          return (
            <li key={row.key} className="niceeval-waterfall-row">
              <div className="niceeval-waterfall-head">
                {row.locator !== undefined ? (
                  (() => {
                    const href = hrefForLocator(ctx, row.locator);
                    return href !== undefined ? (
                      <a className="niceeval-locator" href={href}>
                        {row.locator}
                      </a>
                    ) : (
                      <span className="niceeval-locator">{row.locator}</span>
                    );
                  })()
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
              {row.durationMs !== null && leaves.some((node) => node.durationMs !== null) ? (
                <div className="niceeval-waterfall-track">
                  {leaves.map((node) =>
                    node.durationMs === null ? null : (
                      <span
                        key={node.key}
                        className={cx(
                          "niceeval-waterfall-bar",
                          `niceeval-span-kind-${kindSlot(node.kind)}`,
                          node.failed && "niceeval-span-failed",
                        )}
                        style={{
                          left: pct(node.startOffsetMs, row.durationMs!),
                          // 下限取像素不取百分比:几百个百分比下限段叠起来会把整条铺满。
                          width: `max(${pct(node.durationMs, row.durationMs!)}, 1px)`,
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
      const command =
        row.locator !== undefined ? ctx.command({ page: ATTEMPT_PAGE_ID, params: { locator: row.locator } }) : undefined;
      return command !== undefined ? `${line}   ${command}` : line;
    })
    .join("\n");
  return title !== undefined ? `${resolveLocalizedText(title, ctx.locale)}\n${lines}` : lines;
}

/** 时间树与瀑布:一批带起止偏移的节点,可逐层展开。 */
export const Waterfall = defineComponent<WaterfallProps>({
  dimensions: () => ({}),
  web(props, ctx) {
    const content = props.nodes ?? null;
    if (content === null || content.length === 0) return null;
    const locale = props.locale ?? ctx.locale;
    return renderWaterfallWeb(content, locale, ctx, props.title, props.className);
  },
  text(props, ctx) {
    const content = props.nodes ?? null;
    if (content === null || content.length === 0) return "";
    return waterfallText(content, { ...ctx, locale: props.locale ?? ctx.locale }, props.title);
  },
});
Waterfall.displayName = "Waterfall";
