// 排版原语 Row / Col / Grid / Section / Stat / Text / Markdown / Style / Tabs / Tab / Table:十一个内置
// 双面组件,没有特殊机制(docs/feature/reports/library.md)。web 面是普通 React 渲染;
// text 面用 ctx.render(child, 子宽) 显式传宽。Style 注入页级全局 CSS(树位置只决定声明
// 顺序),text 面渲染为空。Table 是自定义表的标准件,官方表状组件的 text 面也建在它上面。
// Grid / Stat 的语义层(normalizeGrid 展平校验、text 面的 TextGridPlan 排版)在
// ./grid-layout.ts(docs/feature/reports/architecture.md「排版原语的语义层与面内布局」);
// 本文件只声明两面适配,不重复那份算术。

import { Children, type CSSProperties, type ReactNode } from "react";
import type { AttemptLocator } from "../../attempt-locator.ts";
import {
  COMPONENT_RAW_CHILDREN,
  COMPONENT_ROLE,
  defineComponent,
  type ReportComponent,
  type ReportNode,
  type WebContext,
} from "./tree.ts";
import { attemptLocatorOfEvidenceRef, hrefForLocator } from "./primitives/shared.ts";
import { countText, localeText, resolveLocalizedText, type LocalizedText, type ReportLocale } from "../model/locale.ts";
import { joinColumns, padDisplay, stringWidth, wrapDisplay } from "../model/text-layout.ts";
import type { ColumnAlign } from "../model/text-layout.ts";
import {
  DATA_BOX_FRAME_OVERHEAD,
  dataBoxBorder,
  dataBoxMode,
  dataBoxRow,
  panelContentWidth,
  renderPanel,
  renderRule,
  type PanelRow,
} from "../model/panel.ts";
import { renderTableText } from "./table-text.ts";
import { gridContainerRules, normalizeGrid, planTextGrid, TEXT_GRID_SEPARATOR } from "./grid-layout.ts";
import type { Dataset } from "../model/types.ts";
import { isDataset } from "../model/dataset.ts";
import { isMetricValue } from "../model/metrics.ts";
import type { MetricValue } from "../../analysis/index.ts";
import type { ReportTarget } from "./report.ts";
import { assertDownloadFile, type DownloadFile } from "./primitives/downloads.ts";
import {
  emitPanelRow,
  panelSectionDepth,
  withPanelRowCollector,
  withPanelSectionDepth,
} from "./primitives/text-panel-state.ts";
import {
  flattenTableContentForText,
  formatCellText,
  type Cell,
  type ColumnSpec,
  type TableContent,
  type TableContentRow,
} from "./cell.tsx";
import { formatMetricScalar, missingText, verdictMark } from "../model/format.ts";
import { formatCostProjectionAmountText, isCostMetricValue } from "../model/pricing.ts";


function childArray(children: ReportNode): ReportNode[] {
  if (children === null || children === undefined || typeof children === "boolean") return [];
  return Array.isArray(children) ? [...children] : [children];
}

function cx(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** `null`/缺数据的统一显示符:Table 与 Stat 共用,不补成 0。 */
const MISSING_MARK = "—";

export interface LayoutProps {
  children?: ReportNode;
  className?: string;
}

export type RowProps = LayoutProps;
export type ColProps = LayoutProps;

/** 纵向依次排列:网页是块级堆叠,终端是逐块输出(块间空一行)。两面都按声明序。 */
export const Col = defineComponent<ColProps>({
  dimensions: () => ({}),
  web({ children, className }) {
    return (
      <div className={cx("niceeval-report", "niceeval-col", className)}>
        {Children.toArray(children as ReactNode)}
      </div>
    );
  },
  text({ children }, ctx) {
    return childArray(children)
      .map((child) => ctx.render(child))
      .filter((block) => block.length > 0)
      .join("\n\n");
  },
});
Col.displayName = "Col";

const COLUMN_SEPARATOR = " │ ";

/** 一段已渲染文本的自然显示宽度(最长一行)。 */
function blockWidth(block: string): number {
  return Math.max(...block.split("\n").map((line) => stringWidth(line)), 0);
}

/**
 * 并排:web 面横排;text 面在可用宽度装得下全部子块时按显示宽度并排(与 `columns` 工具
 * 同一把尺),装不下时整块退化为纵向堆叠——不截断、不隐藏任何子块。
 */
export const Row = defineComponent<RowProps>({
  dimensions: () => ({}),
  web({ children, className }) {
    return (
      <div className={cx("niceeval-report", "niceeval-row", className)}>
        {Children.toArray(children as ReactNode)}
      </div>
    );
  },
  text({ children }, ctx) {
    const blocks = childArray(children).filter(
      (child) => child !== null && child !== undefined && typeof child !== "boolean",
    );
    if (blocks.length === 0) return "";
    if (blocks.length === 1) return ctx.render(blocks[0]);
    const rendered = blocks.map((child) => ctx.render(child)).filter((block) => block.length > 0);
    if (rendered.length === 0) return "";
    const widths = rendered.map(blockWidth);
    const total = widths.reduce((sum, w) => sum + w, 0) + COLUMN_SEPARATOR.length * (rendered.length - 1);
    if (total > ctx.width) {
      // 装不下:整块退化为纵向堆叠,与 Col 同一形态
      return rendered.join("\n\n");
    }
    return joinColumns(rendered, widths, COLUMN_SEPARATOR);
  },
});
Row.displayName = "Row";

// ───────────────────────── Grid / Stat ─────────────────────────

export type GridProps = LayoutProps;

/**
 * 一行格子的物理行:每格按自己的列宽补白(不 trim 行尾——右边框要对齐成一条直线),
 * 行高取该行最高的那一格,矮格补空白格。
 */
function framedGridRows(blocks: readonly string[], widths: readonly number[], outerFrame: boolean): string[] {
  const columns = blocks.map((block) => block.split("\n"));
  const height = Math.max(...columns.map((lines) => lines.length), 1);
  const out: string[] = [];
  for (let i = 0; i < height; i++) {
    out.push(dataBoxRow(columns.map((lines, c) => padDisplay(lines[i] ?? "", widths[c]!)), outerFrame));
  }
  return out;
}

/**
 * 自由摘要面板的格子容器:只负责呈现,不读取 Sample、不聚合 Metric。每个直接子节点
 * (数组 / Fragment 先按 ReportNode 规则展平,空分支不占格)是一格;`Col` 把多个区块
 * 归成一格。列数、边框与体量全由格数 × 可用宽度算出(./grid-layout.ts),Grid 不收这些
 * 参数,本文件只做两面结构适配。
 */
export const Grid = defineComponent<GridProps>({
  dimensions: () => ({}),
  web({ children, className }) {
    const normalized = normalizeGrid({ children });
    const cellCount = normalized.cells.length;
    const rules = gridContainerRules(cellCount);
    return (
      <div className="niceeval-report niceeval-grid-fit">
        {rules ? <style>{rules}</style> : null}
        <div className={cx("niceeval-report", "niceeval-grid", className)} data-cells={cellCount}>
          {normalized.cells.map((cell) => (
            <div className="niceeval-grid-cell" key={cell.key}>
              {cell.node as ReactNode}
            </div>
          ))}
        </div>
      </div>
    );
  },
  text({ children }, ctx) {
    const normalized = normalizeGrid({ children });
    if (normalized.cells.length === 0) return "";
    const lines = dataBoxMode(ctx.panelMode, ctx.width) === "boxed";
    // 嵌在画框的 Section 里只留列边界与行间线:边界已由面板的框给出,不套二层框。
    const outerFrame = lines && panelSectionDepth() === 0;
    const plan = planTextGrid({
      availableWidth: outerFrame ? ctx.width - DATA_BOX_FRAME_OVERHEAD : ctx.width,
      cellCount: normalized.cells.length,
    });
    // 确定计划后才对每个 cell 调用一次 ctx.render——不为试探列数重复渲染。
    // 末行不足一整行时,最后一格吃掉剩余宽度(只剩一格就是铺满整行)——右边框因此始终
    // 对齐成一条直线,短末行不把框拉成锯齿。
    const cellWidths = normalized.cells.map((_, i) => {
      const col = i % plan.columns;
      const lastRowStart = Math.floor((normalized.cells.length - 1) / plan.columns) * plan.columns;
      const isLastCell = i === normalized.cells.length - 1;
      const lastRowCells = normalized.cells.length - lastRowStart;
      if (!isLastCell || lastRowCells === plan.columns) return plan.contentWidths[col];
      if (lastRowCells === 1) return plan.fullRowContentWidth;
      // 吃掉右侧空出来的列宽与它们的格线。
      const rest = plan.contentWidths.slice(col);
      return rest.reduce((sum, w) => sum + w, 0) + TEXT_GRID_SEPARATOR.length * (rest.length - 1);
    });
    const blocks = normalized.cells.map((cell, i) => ctx.render(cell.node, cellWidths[i]));
    // 格宽贴合内容:计划宽度是排版上限(子节点按它折行),画框时收到这一列真正用掉的宽度
    // ——摘要格里是 `80%`、`$0.92` 这种短读数,格子不为占满终端而撑开。
    const columnWidths = plan.contentWidths.map((planned, col) => {
      const widest = blocks.reduce((max, block, i) => {
        if (i % plan.columns !== col || cellWidths[i] !== planned) return max;
        return Math.max(max, blockWidth(block));
      }, 1);
      return Math.min(planned, widest);
    });
    // 末行吃掉剩余宽度的那一格跟着收:它补的是右侧空出来的列宽与格线,按收窄后的列重算。
    const fittedWidths = cellWidths.map((width, i) => {
      const col = i % plan.columns;
      if (width === plan.contentWidths[col]) return columnWidths[col]!;
      const rest = columnWidths.slice(col);
      return rest.reduce((sum, w) => sum + w, 0) + TEXT_GRID_SEPARATOR.length * (rest.length - 1);
    });
    // 行与行之间是一条行间线,不是空行——格线要连起来才读成一片格子。
    const out: string[] = [];
    let previousRow = 0;
    let lastRowWidths: readonly number[] = plan.contentWidths;
    for (let start = 0; start < blocks.length; start += plan.columns) {
      const rowBlocks = blocks.slice(start, start + plan.columns);
      const rowWidths = fittedWidths.slice(start, start + rowBlocks.length);
      if (!lines) {
        // 朴素形态:格线整体消失,只按列对齐;行与行之间空一行代替行间线。
        if (start > 0) out.push("");
        out.push(joinColumns(rowBlocks, rowWidths, "   "));
        continue;
      }
      if (start === 0 && outerFrame) out.push(dataBoxBorder("top", columnWidths, true));
      if (start > 0) {
        out.push(dataBoxBorder("rule", columnWidths.slice(0, previousRow), outerFrame, rowBlocks.length));
      }
      out.push(...framedGridRows(rowBlocks, rowWidths, outerFrame));
      previousRow = rowBlocks.length;
      // 下边框跟随末行的实际列宽——末行最后一格吃掉的那段宽度也要被下边框盖住。
      lastRowWidths = rowWidths;
    }
    if (lines && outerFrame) out.push(dataBoxBorder("bottom", lastRowWidths, true));
    return out.join("\n");
  },
});
Grid.displayName = "Grid";

export type StatTone = "neutral" | "positive" | "negative" | "warning";

export interface StatProps {
  label: LocalizedText;
  /**
   * 主值。收 Cell 时保住覆盖率与下钻；收标量 / LocalizedText 时是作者已经算好的展示值
   * (与 text 格等价，没有证据可下钻)。
   */
  value: Cell | LocalizedText | number | null;
  /** 主值下面的短解释;省略时不留空行。 */
  detail?: LocalizedText;
  /** 主值的语义色;不从正负号、单位或 Metric.better 猜。默认 neutral。 */
  tone?: StatTone;
  className?: string;
}

/**
 * Grid / Stat 共享的显示值规范化:Cell 走 formatCellText / MetricCellView;
 * LocalizedText 走 resolveLocalizedText,number 走当前 locale 的 Intl.NumberFormat,null 变 —。
 */
function statDisplayOf(value: StatProps["value"], locale: ReportLocale): string {
  if (value === null) return MISSING_MARK;
  if (typeof value === "number") return new Intl.NumberFormat(locale).format(value);
  if (typeof value === "object" && value !== null && "kind" in value) {
    return formatCellText(value as Cell, locale);
  }
  return resolveLocalizedText(value as LocalizedText, locale);
}

function isCellValue(value: StatProps["value"]): value is Cell {
  return typeof value === "object" && value !== null && "kind" in value;
}

/** label / 主值 / 辅助信息的最小内容单元;可以脱离 Grid 单独使用。 */
export const Stat = defineComponent<StatProps>({
  dimensions: () => ({}),
  web({ label, value, detail, tone = "neutral", className }, ctx) {
    return (
      <div className={cx("niceeval-report", "niceeval-stat", `niceeval-stat--${tone}`, className)}>
        <div className="niceeval-stat-label">{resolveLocalizedText(label, ctx.locale)}</div>
        <div className="niceeval-stat-value">
          {isCellValue(value)
            ? renderCellWeb(value, { href: (locator) => hrefForLocator(ctx, locator), locale: ctx.locale, showMeasureRefs: false })
            : statDisplayOf(value, ctx.locale)}
        </div>
        {detail !== undefined ? <div className="niceeval-stat-detail">{resolveLocalizedText(detail, ctx.locale)}</div> : null}
      </div>
    );
  },
  text({ label, value, detail }, ctx) {
    const lines = [resolveLocalizedText(label, ctx.locale), statDisplayOf(value, ctx.locale)];
    if (detail !== undefined) lines.push(resolveLocalizedText(detail, ctx.locale));
    return lines.flatMap((line) => wrapDisplay(line, ctx.width)).join("\n");
  },
});
Stat.displayName = "Stat";

// ───────────────────────── Section ─────────────────────────

export interface SectionProps extends LayoutProps {
  title: LocalizedText;
  /** 标题行右侧的短元信息;text 面与标题同一行,空间不足时换到下一行。 */
  meta?: LocalizedText;
}

/** 带标题的块:网页是标题层级(可选 meta 同行右对齐);终端面框线体裁全部委托给 panel.ts,
 *  这里只负责按 ctx.panelMode 组装 title/meta/rows 喂给它,不自己拼框字符。 */
export const Section = defineComponent<SectionProps>({
  dimensions: () => ({}),
  web({ title, meta, children, className }, ctx) {
    const titleText = resolveLocalizedText(title, ctx.locale);
    const metaText = meta !== undefined ? resolveLocalizedText(meta, ctx.locale) : undefined;
    return (
      <section className={cx("niceeval-report", "niceeval-section", className)}>
        {metaText !== undefined ? (
          <header className="niceeval-section-header">
            <h2 className="niceeval-section-title">{titleText}</h2>
            <p className="niceeval-section-meta">{metaText}</p>
          </header>
        ) : (
          <h2 className="niceeval-section-title">{titleText}</h2>
        )}
        {children as ReactNode}
      </section>
    );
  },
  text({ title, meta, children }, ctx) {
    const heading = resolveLocalizedText(title, ctx.locale);
    const metaText = meta !== undefined ? resolveLocalizedText(meta, ctx.locale) : undefined;

    if (ctx.panelMode !== "boxed") {
      // plain:递归天然处理嵌套(每层 Section 各自渲染标题行 + 两格缩进的正文),不需要
      // 横隔展开——降级后所有 Section 都按同一条规则显示,不区分是否嵌套。
      const body = childArray(children)
        .map((child) => ctx.render(child, ctx.width - 2))
        .filter((block) => block.length > 0)
        .join("\n\n");
      return renderPanel({
        title: heading,
        meta: metaText,
        rows: body.length > 0 ? [{ kind: "line", text: body }] : [],
        width: ctx.width,
        mode: "plain",
      }).join("\n");
    }

    const nested = panelSectionDepth() > 0;
    if (nested) {
      // 横隔走结构化渲染期通道；不把哨兵塞进 text(): string，避免被 Row/Grid 改写或泄漏。
      emitPanelRow({ kind: "divider", title: heading, ...(metaText !== undefined ? { meta: metaText } : {}) });
    }
    // 外层 Section 已经把子树放进内容区；嵌套 Section 只登记横隔，不能再扣一次框宽。
    const contentWidth = nested ? ctx.width : panelContentWidth(ctx.width, "boxed");
    return withPanelSectionDepth(panelSectionDepth() + 1, () => {
      const rows: PanelRow[] = [];
      const body = withPanelRowCollector(
        (row) => rows.push(row),
        () =>
          childArray(children)
            .map((child) => ctx.render(child, contentWidth))
            .filter((block) => block.length > 0)
            .join("\n\n"),
      );
      if (nested) {
        // 更深一层的横隔由本层收集后，继续上交给真正画框的祖先。
        for (const row of rows) emitPanelRow(row);
        return body;
      }
      return renderPanel({
        title: heading,
        meta: metaText,
        rows: [...rows, ...(body.length > 0 ? [{ kind: "line", text: body } satisfies PanelRow] : [])],
        width: ctx.width,
        mode: "boxed",
      }).join("\n");
    });
  },
});
Section.displayName = "Section";

export interface TextProps {
  /** 自由正文原样渲染,不随 locale 自动翻译。 */
  children: string | number;
  className?: string;
}

/** 自由文本的显式载体:web 面负责转义,text 面按显示宽度折行。 */
export const Text = defineComponent<TextProps>({
  dimensions: () => ({}),
  web({ children, className }) {
    return <p className={cx("niceeval-report", "niceeval-text", className)}>{children}</p>;
  },
  text({ children }, ctx) {
    return wrapDisplay(String(children), ctx.width).join("\n");
  },
});
Text.displayName = "Text";
Text[COMPONENT_RAW_CHILDREN] = true;

export interface StyleProps {
  children: string;
}

/**
 * 注入页级全局 CSS:树位置只决定声明顺序,不限定作用域;text 面零输出。
 * 组件级样式优先走 defineRenderer assets;页内 <Style> 用于页级声明。
 */
export const Style = defineComponent<StyleProps>({
  dimensions: () => ({}),
  web({ children }) {
    return <style>{children}</style>;
  },
  text() {
    return "";
  },
});
Style.displayName = "Style";
Style[COMPONENT_RAW_CHILDREN] = true;

// ───────────────────────── Tabs / Tab ─────────────────────────

export interface TabsProps extends LayoutProps {}

export interface TabProps extends LayoutProps {
  title: LocalizedText;
}

interface TabEntry {
  title: LocalizedText;
  children: ReportNode;
  className?: string;
}

/** Tabs 的直接 Tab 子项(数组 / Fragment 已展平;结构合法性由树校验保证)。 */
function tabEntries(children: ReportNode): TabEntry[] {
  const out: TabEntry[] = [];
  const visit = (node: ReportNode): void => {
    if (node === null || node === undefined || typeof node === "boolean") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (typeof node === "object" && node !== null && "props" in node) {
      const element = node as { type: unknown; props: globalThis.Record<string, unknown> };
      if (element.type === Symbol.for("react.fragment")) {
        visit(element.props.children as ReportNode);
        return;
      }
      out.push({
        title: (element.props.title as LocalizedText) ?? "",
        children: element.props.children as ReportNode,
        className: element.props.className as string | undefined,
      });
    }
  };
  visit(children);
  return out;
}

/**
 * 页内并列视图的可切换块。tab 是页内浏览状态,不是数据边界,也不是宿主寻址单位——
 * 两个渲染面都输出全部 tab 的完整内容:web 静态 HTML 每 tab 一个 <details>(首个默认展开,
 * 渐进增强升级成单选 tab 条,切换不改变数据);text 面按声明序输出带标题分节,不折成索引
 * 也不省略(tab 没有选择器,索引只能是死路)。
 */
export const Tabs = defineComponent<TabsProps>({
  dimensions: () => ({}),
  web({ children, className }, ctx) {
    const tabs = tabEntries(children);
    return (
      <div className={cx("niceeval-report", "niceeval-tabs", className)} data-niceeval-tabs>
        {tabs.map((tab, i) => (
          <details key={i} className={cx("niceeval-tab", tab.className)} open={i === 0}>
            <summary className="niceeval-tab-title">{resolveLocalizedText(tab.title, ctx.locale)}</summary>
            <div className="niceeval-tab-body">{tab.children as ReactNode}</div>
          </details>
        ))}
      </div>
    );
  },
  text({ children }, ctx) {
    const tabs = tabEntries(children);
    return tabs
      .map((tab, i) => {
        // 隔条只标注归属,不声明边界:tab 正文按整个可用宽度排版、不缩进,宽表与图表在 tab 里
        // 和直接铺在页上占同样的列宽(体裁与理由见 layout.md「区域框」的画框资格段)。
        const heading = resolveLocalizedText(tab.title, ctx.locale);
        const rule = renderRule({
          title: `${heading} ${i + 1}/${tabs.length}`,
          width: ctx.width,
          mode: ctx.panelMode,
        });
        const body = childArray(tab.children)
          .map((child) => ctx.render(child, ctx.width))
          .filter((block) => block.length > 0)
          .join("\n\n");
        return body.length > 0 ? `${rule}\n\n${body}` : rule;
      })
      .join("\n\n");
  },
});
Tabs.displayName = "Tabs";
Tabs[COMPONENT_ROLE] = "tabs";

/** 只能直接放在 <Tabs> 下;除通用 children / className 外只有 title。不参与路由,没有 id。 */
export const Tab = defineComponent<TabProps>({
  dimensions: () => ({}),
  web({ children, className }) {
    return <div className={cx("niceeval-report", "niceeval-tab-body", className)}>{children as ReactNode}</div>;
  },
  text({ children }, ctx) {
    return childArray(children)
      .map((child) => ctx.render(child))
      .filter((block) => block.length > 0)
      .join("\n\n");
  },
});
Tab.displayName = "Tab";
Tab[COMPONENT_ROLE] = "tab";

// ───────────────────────── Table ─────────────────────────

/** 一列的定义:取哪个 cells 键、表头写什么、往哪边对齐(旧形态 / text 排版共用)。 */
export interface TableColumn {
  /** 取 `row.cells[key]` 的键。 */
  key: string;
  /** 表头文案,按渲染 locale 选择。 */
  header: LocalizedText;
  /** 对齐方向,默认 `"left"`;`"right"` 按显示宽度右对齐,数字列用。 */
  align?: ColumnAlign;
  /** 排序方向提示；省略时该列不可排序。 */
  better?: "higher" | "lower";
  /**
   * text 面:单元格折行后的最大物理行数,放不下的部分以 `…` 收口;省略则不限行数。
   * web 面不消费——网页的高度约束是组件自己的 CSS 决定。
   */
  maxLines?: number;
}

/** 一行的旧形态数据:已格式化的字符串格子。新形态见 TableContentRow。 */
export interface TableRow {
  key: string;
  cells: Readonly<globalThis.Record<string, string | null>>;
  locator?: AttemptLocator;
  /** 行树里的层数(顶层 0,省略等同 0)。text 面据此画组边界横线;普通 rows 形态是平表。 */
  depth?: number;
}

export interface TablePresentation {
  sort?: string;
  searchable?: boolean;
  locale?: ReportLocale;
  className?: string;
}

/** docs: `columns` 项可以是字段名或 `{ field, label?, hidden? }`。 */
export type PlainTableColumn<Row extends object = globalThis.Record<string, unknown>> =
  | (keyof Row & string)
  | {
      field: keyof Row & string;
      label?: LocalizedText;
      hidden?: boolean;
    };

/**
 * Table 的公开 props：普通 `rows`（AggregateRow / EvidenceRow / 实体投影）。
 */
export type TableProps<Row extends object = globalThis.Record<string, unknown>> = {
  rows: readonly Row[];
  columns?: readonly PlainTableColumn<Row>[];
} & TablePresentation;

/** 官方组合组件内部的富 Cell 形状；不从 niceeval/report 导出。 */
export type TableContentViewProps = {
  data: TableContent | Dataset | null;
} & TablePresentation;

type TableImplementationProps = TableProps | TableContentViewProps;

function isPlainRowsTableProps(props: TableImplementationProps): props is TableProps {
  return "rows" in props;
}

function isLocalizedTextValue(value: unknown): value is LocalizedText {
  if (typeof value === "string") return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as globalThis.Record<string, unknown>).every((v) => typeof v === "string");
}

function isPlainCellValue(value: unknown): value is Cell {
  return !!value && typeof value === "object" && !Array.isArray(value) && "kind" in value;
}

/**
 * Dataset → TableContent（Table 原语消费）。model/dataset.ts 提供封闭投影；面向
 * TableContentView 的展示投影由 tableContentOf 在这里消费。
 */
function datasetToTableContent(dataset: Dataset): TableContent {
  const columns = dataset.fields.map((f) => ({
    key: f.name,
    ...(f.kind === "metric" && (f.better === "higher" || f.better === "lower") ? { better: f.better } : {}),
    ...(f.unit !== undefined ? { unit: f.unit } : {}),
  }));
  const rows = dataset.rows.map((row) => {
    const cells: globalThis.Record<string, Cell> = {};
    for (const field of dataset.fields) {
      const value = row.values[field.name];
      if (field.kind === "dimension") {
        cells[field.name] = { kind: "text", text: String(value ?? row.key) };
        continue;
      }
      if (!isMetricValue(value)) {
        throw new Error(`Dataset row "${row.key}" is missing measure cell for field "${field.name}".`);
      }
      cells[field.name] = { kind: "metric", metric: value };
    }
    return { key: row.key, cells };
  });
  return { columns, rows };
}

function plainValueToCell(value: unknown, path: string, locale: ReportLocale): Cell {
  if (value === undefined) {
    throw new Error(`Table ${path} is missing — every declared column must exist on the row object.`);
  }
  if (isMetricValue(value)) {
    return { kind: "metric", metric: value };
  }
  if (isPlainCellValue(value)) return value;
  if (value === null) return { kind: "text", text: "—" };
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return { kind: "text", text: String(value) };
  }
  if (isLocalizedTextValue(value)) {
    return { kind: "text", text: resolveLocalizedText(value, locale) };
  }
  if (Array.isArray(value)) {
    throw new Error(
      `Table ${path} is an array — Table rows only accept scalars, LocalizedText, MetricValue, or Cell. Flatten or pick a display field before render.`,
    );
  }
  throw new Error(
    `Table ${path} has unsupported object type — Table rows only accept scalars, LocalizedText, MetricValue, or Cell.`,
  );
}

function resolvePlainColumnSpecs(
  rows: readonly globalThis.Record<string, unknown>[],
  columns: readonly PlainTableColumn[] | undefined,
): Array<{ field: string; label?: LocalizedText }> {
  if (columns && columns.length > 0) {
    const out: Array<{ field: string; label?: LocalizedText }> = [];
    for (const col of columns) {
      if (typeof col === "string") {
        out.push({ field: col });
        continue;
      }
      if (col.hidden) continue;
      out.push({
        field: col.field,
        ...(col.label !== undefined ? { label: col.label } : {}),
      });
    }
    return out;
  }
  const first = rows[0];
  if (!first || typeof first !== "object") return [];
  return Object.keys(first)
    .filter((key) => key !== "refs")
    .map((field) => ({ field }));
}

function plainRowsToTableContent(
  rows: readonly globalThis.Record<string, unknown>[],
  columnSpecs: Array<{ field: string; label?: LocalizedText }>,
  locale: ReportLocale,
): TableContent {
  if (columnSpecs.length === 0) {
    throw new Error("Table needs at least one column: pass columns, or provide a non-empty rows array with fields.");
  }
  const columns: ColumnSpec[] = columnSpecs.map((spec) => {
    const sample = rows
      .map((row) => {
        const value = row[spec.field];
        if (isMetricValue(value)) return value;
        return isPlainCellValue(value) && value.kind === "metric" ? value.metric : undefined;
      })
      .find((value): value is MetricValue => value !== undefined);
    // 语义适配:当前 MetricValue.better 含 "neutral";列排序方向只认 higher/lower。
    const better = sample?.better === "higher" || sample?.better === "lower" ? sample.better : undefined;
    return {
      key: spec.field,
      ...(sample?.unit !== undefined ? { unit: sample.unit } : {}),
      ...(better !== undefined ? { better } : {}),
    };
  });
  const contentRows: TableContentRow[] = rows.map((row, index) => {
    // 语义适配:closed 行身份优先取显式 key;缺失时取第一条 evidence ref 的 attempt
    // locator;再缺才按字段值拼稳定 key。
    const refs = row.refs;
    const firstRefLocator =
      Array.isArray(refs) && refs.length > 0
        ? attemptLocatorOfEvidenceRef(refs[0] as NonNullable<typeof refs>[number])
        : undefined;
    const key =
      typeof row.key === "string"
        ? row.key
        : firstRefLocator !== undefined
          ? firstRefLocator
          : columnSpecs.map((c) => `${c.field}=${String(row[c.field])}`).join("|") || `row-${index}`;
    const cells: globalThis.Record<string, Cell> = {};
    for (const spec of columnSpecs) {
      if (!(spec.field in row)) {
        throw new Error(`Table rows[${index}].${spec.field} is missing — row shape must match columns.`);
      }
      cells[spec.field] = plainValueToCell(row[spec.field], `rows[${index}].${spec.field}`, locale);
    }
    return { key, cells };
  });
  return { columns, rows: contentRows };
}

// props → 唯一权威形态:列 + 层级 TableContent。校验只在这里做一次,
// text / web 两面拿到的是同一棵已校验的行树;text 面的展平是渲染期投影,
// 不进权威形态,行 key 判重与行形状校验因此永远按层级同层进行。
function tableContentOf(props: TableImplementationProps, locale: ReportLocale): {
  columns: [TableColumn, ...TableColumn[]];
  content: TableContent;
} {
  if (isPlainRowsTableProps(props)) {
    const specs = resolvePlainColumnSpecs(props.rows as readonly globalThis.Record<string, unknown>[], props.columns as readonly PlainTableColumn[] | undefined);
    const content = plainRowsToTableContent(
      props.rows as readonly globalThis.Record<string, unknown>[],
      specs,
      locale,
    );
    // 公开 rows 形态:默认原样显示字段名,`label` 覆盖。
    const columns: TableColumn[] = specs.map((spec) => ({
      key: spec.field,
      header: spec.label ?? spec.field,
      align: content.columns.find((c) => c.key === spec.field)?.better ? "right" : "left",
      better: content.columns.find((c) => c.key === spec.field)?.better,
    }));
    return validatedTable(columns, content);
  }
  const raw = props.data;
  const content = raw === null ? null : isDataset(raw) ? datasetToTableContent(raw) : raw;
  if (content === null) return validatedTable([], { columns: [], rows: [] });
  // 表头长在列声明上;没声明就是 key 原样(维度值列走这一支)。
  const columns: TableColumn[] = content.columns.map((spec) => ({
    key: spec.key,
    header: spec.header ?? spec.key,
    align: spec.better ? "right" : "left",
    better: spec.better,
  }));
  return validatedTable(columns, content);
}

function validatedTable(
  columns: TableColumn[],
  content: TableContent,
): { columns: [TableColumn, ...TableColumn[]]; content: TableContent } {
  if (columns.length === 0) {
    throw new Error("Table needs at least one column: pass columns, or provide rows whose first item has visible fields.");
  }
  const keys = new Set<string>();
  for (const column of columns) {
    if (keys.has(column.key)) {
      throw new Error(`Table column key "${column.key}" is declared twice — column keys address row.cells and must be unique. Rename one column.`);
    }
    keys.add(column.key);
  }
  validateSiblingRowKeys(content.rows);
  validateRowShapes(content.rows, keys);
  return { columns: columns as [TableColumn, ...TableColumn[]], content };
}

/**
 * 行形状与列集同源:每一行(含 group / placeholder 与各层子行)的 cells key 集合
 * 等于列集。不适用的列显式填 notApplicable,不靠缺格回落成 `—`
 * (docs/feature/reports/library.md「Content 协议」)。
 */
function validateRowShapes(rows: readonly TableContentRow[], columnKeys: ReadonlySet<string>): void {
  for (const row of rows) {
    for (const cellKey of Object.keys(row.cells)) {
      if (!columnKeys.has(cellKey)) {
        throw new Error(
          `Table row "${row.key}" has a cell for "${cellKey}", which is not a declared column — row cells and the column set must match exactly, so this cell can never be rendered. Drop the cell, or declare a "${cellKey}" column.`,
        );
      }
    }
    for (const columnKey of columnKeys) {
      if (!(columnKey in row.cells)) {
        throw new Error(
          `Table row "${row.key}" has no cell for column "${columnKey}" — every declared column needs a cell on every row. Fill it with { kind: "notApplicable" } when the column does not apply to this row.`,
        );
      }
    }
    if (row.subRows?.length) validateRowShapes(row.subRows, columnKeys);
  }
}

function validateSiblingRowKeys(rows: readonly TableContentRow[]): void {
  const keys = new Set<string>();
  for (const row of rows) {
    if (keys.has(row.key)) {
      throw new Error(
        `Table row key "${row.key}" is declared twice at the same level — sibling row keys are the row identity and must be unique.`,
      );
    }
    keys.add(row.key);
    if (row.subRows?.length) validateSiblingRowKeys(row.subRows);
  }
}

// ───────────────────────── Metric 格渲染 ─────────────────────────
// refs 是 closed EvidenceRef 对象；href 只对 identity.kind === "attempt" 的 ref
// 生成，其它 ref 退化为纯文本序号，不拼假链接。

/** closed refs 里能变成下钻目标的 attempt locator;单 ref 才可能成链,多 ref 各列一个序号。 */
function refLocatorsOf(refs: readonly MetricValue["refs"][number][]): AttemptLocator[] {
  return refs.flatMap((ref) => {
    const locator = attemptLocatorOfEvidenceRef(ref);
    return locator === undefined ? [] : [locator];
  });
}

function MetricCellView({
  cell,
  href,
  locale,
  showCoverage = true,
}: {
  cell: MetricValue;
  /** 单个 locator → URL;缺省(宿主不认识 attempt 目标)时不出现证据链接。 */
  href?: (locator: AttemptLocator) => string | undefined;
  locale?: ReportLocale;
  /** 默认用紧凑角标显示覆盖率；已有展开说明的摘要卡可关闭角标。 */
  showCoverage?: boolean;
}): ReactNode {
  const loc = locale ?? "en";
  if (isCostMetricValue(cell)) {
    return (
      <span className="niceeval-cell">
        <span className="niceeval-value">{formatCostProjectionAmountText(cell, loc)}</span>
      </span>
    );
  }
  const text = cell.value === null
    ? missingText("noSamples", loc)
    : formatMetricScalar(cell.value, cell.unit, cell.format, loc);
  if (cell.value === null) {
    return (
      <span className="niceeval-cell niceeval-cell-missing">
        <span className="niceeval-missing" title={localeText(loc, "cell.noneMeasurableTitle", { total: cell.total })}>
          {text}
        </span>
      </span>
    );
  }
  const refLocators = refLocatorsOf(cell.refs);
  return (
    <span className="niceeval-cell">
      <span
        className="niceeval-value"
        title={localeText(loc, "cell.measuredTitle", { samples: cell.samples, total: cell.total })}
      >
        {text}
      </span>
      {showCoverage && cell.samples < cell.total && (
        <sup
          className="niceeval-coverage"
          title={localeText(loc, "cell.coverageTitle", { samples: cell.samples, total: cell.total })}
        >
          {cell.samples}/{cell.total}
        </sup>
      )}
      {href && refLocators.length === 1 && href(refLocators[0]!) !== undefined && (
        <span className="niceeval-refs">
          <a className="niceeval-ref" href={href(refLocators[0]!)}>
            #1
          </a>
        </span>
      )}
      {href && refLocators.length > 1 && (
        <details className="niceeval-refs">
          <summary className="niceeval-refs-summary">{countText(loc, "cell.evidence", refLocators.length)}</summary>
          <span className="niceeval-refs-list">
            {refLocators.map((locator, i) =>
              href(locator) !== undefined ? (
                <a key={locator} className="niceeval-ref" href={href(locator)}>
                  #{i + 1}
                </a>
              ) : (
                <span key={locator} className="niceeval-ref-text">
                  #{i + 1}
                </span>
              ),
            )}
          </span>
        </details>
      )}
    </span>
  );
}

function renderCellWeb(
  cell: Cell | undefined,
  ctx: { href: (locator: AttemptLocator) => string | undefined; locale: ReportLocale; showMeasureRefs?: boolean },
): ReactNode {
  if (!cell) return <span className="niceeval-missing">{MISSING_MARK}</span>;
  switch (cell.kind) {
    case "notApplicable":
      return <span className="niceeval-missing">{MISSING_MARK}</span>;
    case "missing": {
      return (
        <span className="niceeval-missing">
          <span className="niceeval-missing-reason">{missingText(cell.code, ctx.locale)}</span>
          {cell.detail ? <small className="niceeval-cell-detail">{cell.detail}</small> : null}
        </span>
      );
    }
    case "text":
      return (
        <span className="niceeval-cell-text">
          <span>{cell.text}</span>
          {cell.detail ? <small className="niceeval-cell-detail">{cell.detail}</small> : null}
        </span>
      );
    case "locator": {
      // 判定长在 locator 上:判定符与语义色同场,不靠颜色单独表意
      // (docs/feature/reports/library.md)。
      const verdict = cell.verdict;
      const className = cx(
        "niceeval-locator",
        verdict !== undefined ? `niceeval-verdict-${verdict}` : undefined,
      );
      const mark = verdict === undefined ? null : (
        <span className="niceeval-locator-mark" aria-hidden="true">
          {verdictMark(verdict === "skipped" ? "skipped" : verdict)}
        </span>
      );
      const href = ctx.href(cell.locator);
      return href !== undefined ? (
        <a className={className} href={href}>
          {mark}
          {cell.locator}
        </a>
      ) : (
        <span className={className}>
          {mark}
          {cell.locator}
        </span>
      );
    }
    case "summary":
    case "score":
      return formatCellText(cell, ctx.locale);
    case "verdict": {
      if (cell.counts) {
        const parts = (["passed", "failed", "errored", "skipped"] as const).filter((kind) => cell.counts![kind] > 0);
        return (
          <span className="niceeval-verdict-tally">
            {parts.map((kind) => (
              <span className={`niceeval-verdict-${kind}`} key={kind}>
                {cell.counts![kind]} {localeText(ctx.locale, `verdict.${kind === "skipped" ? "skipped" : kind}`)}
              </span>
            ))}
            {parts.length === 0 ? <span className="niceeval-missing">{MISSING_MARK}</span> : null}
          </span>
        );
      }
      const verdict = cell.verdict ?? "skipped";
      // 判定符走 verdictMark 单源,与 locator 格同一张表(errored 是 `!`,不并到 `✗`)。
      return (
        <span className={cx("niceeval-verdict", `niceeval-verdict-${verdict}`)}>
          {verdictMark(verdict === "skipped" ? "skipped" : verdict)}
          {!cell.bare ? <>{" "}{localeText(ctx.locale, `verdict.${verdict === "skipped" ? "skipped" : verdict}`)}</> : null}
        </span>
      );
    }
    case "metric":
      return (
        <MetricCellView
          cell={cell.metric}
          href={ctx.showMeasureRefs === false ? undefined : ctx.href}
          locale={ctx.locale}
          showCoverage={cell.showCoverage !== false}
        />
      );
    default: {
      const _e: never = cell;
      return _e;
    }
  }
}

function cellSortValue(cell: Cell | undefined): string | number {
  if (!cell) return "";
  if (cell.kind === "metric") return cell.metric.value ?? "";
  if (cell.kind === "score") return cell.earned;
  if (cell.kind === "text") return cell.text;
  if (cell.kind === "locator") return cell.locator;
  if (cell.kind === "verdict" && cell.counts) return cell.counts.passed;
  return formatCellText(cell);
}

/**
 * 层级表的列轨:只声明宽度从哪来,不写每列多宽。身份列吃掉余量并留可读下限;其余列
 * `fit-content` 贴着自己那一列的内容(封顶一列可读宽度,长文本在列内折行而不是撑爆整表)。
 * 列数以外不看列身份——表格不认识"这是成本列所以窄一点"。
 */
function hierarchyGrid(columns: readonly TableColumn[]): string {
  if (columns.length === 1) return "minmax(15rem, 1fr)";
  return `minmax(15rem, 1fr) repeat(${columns.length - 1}, fit-content(20rem))`;
}

function renderHierarchyRowsWeb(
  rows: readonly TableContentRow[],
  columns: readonly TableColumn[],
  ctx: {
    href: (locator: AttemptLocator) => string | undefined;
    locale: ReportLocale;
    showMeasureRefs?: boolean;
  },
  depth = 0,
): ReactNode[] {
  return rows.map((row) => {
    const cells = columns.map((column, index) => (
      <span
        className={cx("niceeval-table-hierarchy-cell", column.align === "right" ? "niceeval-align-right" : undefined)}
        data-sort-value={cellSortValue(row.cells[column.key])}
        key={column.key}
        style={index === 0 && depth > 0 ? { paddingLeft: `${depth * 1.25}rem` } : undefined}
      >
        {renderCellWeb(row.cells[column.key], ctx)}
      </span>
    ));
    const className = cx(
      "niceeval-table-hierarchy-row",
      row.variant === "placeholder" ? "niceeval-row-placeholder" : undefined,
      row.variant === "group" ? "niceeval-row-group" : undefined,
    );
    if (!row.subRows?.length) {
      return (
        <div className={className} data-depth={depth || undefined} key={row.key}>
          {cells}
        </div>
      );
    }
    return (
      <details className={cx(className, "niceeval-table-hierarchy-group")} data-depth={depth || undefined} key={row.key}>
        <summary className="niceeval-table-hierarchy-summary">{cells}</summary>
        <div className="niceeval-table-hierarchy-children">
          {renderHierarchyRowsWeb(row.subRows, columns, ctx, depth + 1)}
        </div>
      </details>
    );
  });
}

function renderFlatContentRowsWeb(
  rows: readonly TableContentRow[],
  columns: readonly TableColumn[],
  ctx: { href: (locator: AttemptLocator) => string | undefined; locale: ReportLocale },
): ReactNode[] {
  return rows.map((row) => (
    <tr
      key={row.key}
      className={cx(
        row.variant === "placeholder" ? "niceeval-row-placeholder" : undefined,
        row.variant === "group" ? "niceeval-row-group" : undefined,
      )}
    >
      {columns.map((column) => (
        <td key={column.key} className={column.align === "right" ? "niceeval-align-right" : undefined}>
          {renderCellWeb(row.cells[column.key], ctx)}
        </td>
      ))}
    </tr>
  ));
}

/**
 * 行 × 列原语：公开面吃普通 rows；内部组合组件经 TableContentView 复用同一双面实现。
 */
const TableImplementation = defineComponent<TableImplementationProps>({
  dimensions: () => ({}),
  web(props, ctx) {
    const locale = props.locale ?? ctx.locale;
    const { columns, content } = tableContentOf(props, locale);
    const alignClass = (align?: ColumnAlign) => (align === "right" ? "niceeval-align-right" : undefined);
    const href = (locator: AttemptLocator) => hrefForLocator(ctx, locator);
    const hierarchical = content.rows.some((row) => (row.subRows?.length ?? 0) > 0);
    const table = (
      <table
        className={cx("niceeval-report", "niceeval-table", hierarchical ? "niceeval-table--hierarchical" : undefined, props.className)}
        style={hierarchical ? ({ "--table-grid": hierarchyGrid(columns) } as CSSProperties) : undefined}
      >
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cx(
                  alignClass(column.align),
                  props.sort === column.key
                    ? column.better === "lower"
                      ? "niceeval-sort-asc"
                      : "niceeval-sort-desc"
                    : undefined,
                )}
                data-niceeval-sort={column.better ? column.key : undefined}
              >
                {resolveLocalizedText(column.header, locale)}
              </th>
            ))}
          </tr>
        </thead>
        {hierarchical ? (
          <tbody>
            <tr>
              <td colSpan={columns.length} className="niceeval-table-hierarchy-body">
                {renderHierarchyRowsWeb(content.rows, columns, {
                  href,
                  locale,
                  showMeasureRefs: false,
                })}
              </td>
            </tr>
          </tbody>
        ) : (
          <tbody>{renderFlatContentRowsWeb(content.rows, columns, { href, locale })}</tbody>
        )}
      </table>
    );
    const searchable = props.searchable === true;
    if (!searchable) return table;
    return (
      <div className="niceeval-report niceeval-table-wrap">
        <input
          className="niceeval-filter"
          data-niceeval-filter=""
          type="search"
          placeholder={localeText(
            locale,
            columns[0].key === "entity" ? "experimentList.filterPlaceholder" : "table.filterPlaceholder",
          )}
        />
        {table}
      </div>
    );
  },
  text(props, ctx) {
    const locale = props.locale ?? ctx.locale;
    const { columns, content } = tableContentOf(props, locale);
    const flat = flattenTableContentForText(content, locale);
    return renderTableText(
      { columns, rows: flat.rows.map((row) => ({ key: row.key, cells: row.cells, depth: row.depth })), locale },
      ctx,
    );
  },
});
type TableComponent = ReportComponent<TableProps> & {
  <Row extends object>(props: TableProps<Row>): ReactNode;
};

export const Table = TableImplementation as TableComponent;
export const TableContentView = TableImplementation as ReportComponent<TableContentViewProps>;
Table.displayName = "Table";

// ───────────────────────── Link / Download 双面原语 ─────────────────────────
// Link 与 Download 直接消费普通 closed 值；链接由 ctx.href/ctx.command 解析，下载由 Host
// 的 asset closure 收集，不经过 generic semantic model。

/**
 * Host 经 `ctx.href` 服务下载目标时使用的保留 target page id。它不是作者可声明的 Page,
 * 也不进页索引;Host 的 href 实现按 `params.path` 把下载映射到 revision 里已经收集的
 * 下载文件 URL。作者 Page 不得使用这个 id(与 `ATTEMPT_PAGE_ID` 同一条集中知识纪律)。
 */
export const DOWNLOAD_TARGET_PAGE = "niceeval.report.download";

export interface LinkProps {
  /** 下钻目标。目标页不存在、params 编码失败或宿主服务不了时两面退化为纯文本——不产出空/假 href。 */
  target: ReportTarget;
  /** 链接内容(报告树;resolve 正常展开,text 面按当前宽度渲染)。 */
  children?: ReportNode;
  className?: string;
}

/**
 * 作者显式下钻链接。web 面经 `ctx.href(target)` 成链(undefined 时渲染纯文本 span);
 * text 面经 `ctx.command(target)` 给出下钻命令(undefined 时只渲染内容文本)。
 * 与表格格、图表点共用同一条「目标 → href/命令」唯一通道,组件对宿主能力零知识。
 */
export const Link = defineComponent<LinkProps>({
  dimensions: () => ({}),
  web({ target, children, className }, ctx) {
    const href = ctx.href(target);
    const content = children as ReactNode;
    if (href !== undefined) {
      return (
        <a className={cx("niceeval-report", "niceeval-link", className)} href={href}>
          {content}
        </a>
      );
    }
    return (
      <span className={cx("niceeval-report", "niceeval-link", "niceeval-link--plain", className)}>{content}</span>
    );
  },
  text({ target, children }, ctx) {
    const command = ctx.command(target);
    const body = childArray(children)
      .map((child) => typeof child === "string" || typeof child === "number" || typeof child === "bigint"
        ? String(child)
        : ctx.render(child))
      .filter((block) => block.length > 0)
      .join("\n\n");
    if (command === undefined) return body;
    return body.length > 0 ? `${body}   ${command}` : command;
  },
});
Link.displayName = "Link";
// Link labels intentionally accept ordinary React text children. The face
// above owns their explicit text semantics.
Link[COMPONENT_RAW_CHILDREN] = true;

export interface DownloadProps {
  /** 已关闭的下载文件。渲染面只做形状校验,绝不改写 bytes;Host 用 downloads.ts 的收集器。 */
  file: DownloadFile;
  /** 链接文字;省略时用 file.path。 */
  label?: LocalizedText;
  className?: string;
}

/**
 * 站点下载链接(可访问性:链接文字就是可访问名称;`download` 提示浏览器保存、
 * `type` 标注媒体类型)。`file.bytes` 留在已 resolve 的 props 里,由 Host 经
 * `./primitives/downloads.ts` 的 `collectDownloads` 复制进 revision 下载集
 * (内部导出,不进 niceeval/report 公共出口),并把
 * `ctx.href({ page: DOWNLOAD_TARGET_PAGE, params: { path } })` 映射到该文件的最终
 * 站点 URL;web 面拿不到该 URL 时退化为纯文本;text 面给出 `niceeval` 下钻命令或
 * 原样列出 path。两面都不读 Sample、不重新解释 path 或 bytes。
 */
export const Download = defineComponent<DownloadProps>({
  dimensions: () => ({}),
  web({ file, label, className }, ctx) {
    assertDownloadFile(file);
    const locale = ctx.locale;
    const text = label !== undefined ? resolveLocalizedText(label, locale) : file.path;
    const href = ctx.href({ page: DOWNLOAD_TARGET_PAGE, params: { path: file.path } });
    if (href !== undefined) {
      return (
        <a
          className={cx("niceeval-report", "niceeval-download", className)}
          href={href}
          download={file.path.split("/").pop()}
          type={file.mediaType}
        >
          {text}
        </a>
      );
    }
    return (
      <span className={cx("niceeval-report", "niceeval-download", "niceeval-download--plain", className)}>
        {text}
      </span>
    );
  },
  text({ file, label }, ctx) {
    assertDownloadFile(file);
    const title = label !== undefined ? resolveLocalizedText(label, ctx.locale) : file.path;
    const command = ctx.command({ page: DOWNLOAD_TARGET_PAGE, params: { path: file.path } });
    if (command !== undefined) return `${title}   ${command}`;
    return title === file.path ? file.path : `${title}\n  ${file.path}`;
  },
});
Download.displayName = "Download";

// 公开面只含组件与类型;downloads.ts 的收集器是内部导出,不得从这里 re-export。
export type { DownloadFile } from "./primitives/downloads.ts";

export { Waterfall, waterfallText } from "./primitives/waterfall.tsx";
export type { WaterfallContent, WaterfallNode, WaterfallProps, WaterfallRow } from "./primitives/waterfall.tsx";

export { Callouts } from "./primitives/callouts.tsx";
export type { CalloutGroup, CalloutItem, CalloutLevel, CalloutsProps } from "./primitives/callouts.tsx";
export { CopyBlock } from "./primitives/copy-block.tsx";
export type { CopyBlockContent, CopyBlockProps } from "./primitives/copy-block.tsx";

export { DiffView, diffViewText } from "./primitives/diff-view.tsx";
export type { DiffChange, DiffContent, DiffFile, DiffFileWindow, DiffViewProps } from "./primitives/diff-view.tsx";

export { CommandEvidence, Conversation, ConversationEntries, conversationText, sanitizeConversationPreview } from "./primitives/conversation.tsx";
export { TurnTrace, type TurnTraceProps } from "./primitives/turn-trace.tsx";
export type {
  CommandEvidenceContent,
  CommandEvidenceItem,
  CommandEvidenceProps,
  ConversationContent,
  ConversationEntry,
  ConversationProps,
  ConversationTurn,
} from "./primitives/conversation.tsx";

export { Markdown, parseMarkdown, markdownToText, markdownToWeb } from "./primitives/markdown.tsx";
export type { MarkdownAst, MarkdownProps } from "./primitives/markdown.tsx";

export { SourceView, sourceViewText } from "./primitives/source-view.tsx";
export type {
  SourceBlockContent,
  SourceCallContent,
  SourceContent,
  SourceLine,
  SourceLineTone,
  SourceViewProps,
} from "./primitives/source-view.tsx";

export { Chart, Series } from "./primitives/chart.tsx";
export type { ChartPresentation, ChartProps } from "./primitives/chart.tsx";
export type { SeriesProps, ChartAxisBinding, ChartFieldBinding, ChartSeriesOverride } from "./primitives/chart-map.ts";
export { Scatter, Line, Bars, Area, applyBarsSortLimit } from "./primitives/marks.tsx";
export type {
  ScatterProps,
  ExternalScatterProps,
  LineProps,
  ExternalLineProps,
  BarsProps,
  ExternalBarsProps,
  BarsSort,
  EvidenceAxisKey,
  EvidenceDimensionKey,
  ExternalAxisKey,
  AreaProps,
  ExternalAreaProps,
} from "./primitives/marks.tsx";
export { pointsToDataset } from "./primitives/points-dataset.ts";
export type { ExternalPoint, PointsChartFields } from "./primitives/points-dataset.ts";
