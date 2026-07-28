// 排版原语 Row / Col / Grid / Section / Stat / Text / Markdown / Style / Tabs / Tab / Table:十一个内置
// 双面组件,没有特殊机制(docs/feature/reports/library/layout.md)。web 面是普通 React 渲染;
// text 面用 ctx.render(child, 子宽) 显式传宽。Style 注入页级全局 CSS(树位置只决定声明
// 顺序),text 面渲染为空。Table 是自定义表的标准件,官方表状组件的 text 面也建在它上面。
// Grid / Stat 的语义层(normalizeGrid 展平校验、text 面的 TextGridPlan 排版)在
// ./grid-layout.ts(docs/feature/reports/architecture.md「排版原语的语义层与面内布局」);
// 本文件只声明两面适配,不重复那份算术。

import type { CSSProperties, ReactNode } from "react";
import type { AttemptLocator } from "../../record/locator.ts";
import { COMPONENT_RAW_CHILDREN, COMPONENT_ROLE, defineComponent, type ReportNode } from "./tree.ts";
import { localeText, resolveLocalizedText, type LocalizedText, type ReportLocale } from "../model/locale.ts";
import { indentBlock, joinColumns, padDisplay, stringWidth, wrapDisplay } from "../model/text-layout.ts";
import type { ColumnAlign } from "../model/text-layout.ts";
import { panelContentWidth, renderPanel, type PanelRow } from "../model/panel.ts";
import { renderTableText } from "./table-text.ts";
import { normalizeGrid, planTextGrid, type GridDensity, type GridVariant } from "./grid-layout.ts";
import type { Source, SourceInput } from "../source.ts";
import type { Dataset } from "../model/types.ts";
import { datasetToTableContent, isDataset } from "../model/dataset.ts";
import {
  flattenTableContentForText,
  formatCellText,
  type Cell,
  type ColumnSpec,
  type TableContent,
  type TableContentRow,
} from "./cell.ts";
import { MetricCellView } from "../components/cell.tsx";


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
    return <div className={cx("nre", "nre-col", className)}>{children as ReactNode}</div>;
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
    return <div className={cx("nre", "nre-row", className)}>{children as ReactNode}</div>;
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

export interface GridProps extends LayoutProps {
  /** 宽面最多摆几列;必须是有限正整数,运行时校验(docs/feature/reports/library/layout.md「Grid 与 Stat」)。 */
  columns: number;
  /** plain 无框;boxed 给每个 cell 完整四边框。默认 plain。 */
  variant?: GridVariant;
  /** 改变格内留白,并调整内置 Stat 的主值字号;不改变内容和分组。默认 regular。 */
  density?: GridDensity;
}

/** boxed 单个 cell 的完整边框:同一份 TextGridPlan 决定内容宽度,四边不因换行残缺。 */
function boxCellBlock(content: string, contentWidth: number): string {
  const lines = content.length > 0 ? content.split("\n") : [""];
  const top = `┌${"─".repeat(contentWidth + 2)}┐`;
  const bottom = `└${"─".repeat(contentWidth + 2)}┘`;
  const body = lines.map((line) => `│ ${padDisplay(line, contentWidth)} │`);
  return [top, ...body, bottom].join("\n");
}

/** 一个物理行内的 cell 并排:顶对齐、短 block 补空行到同高(joinColumns 已有语义)。 */
function renderGridRow(blocks: string[], contentWidths: number[], gutter: number, variant: GridVariant): string {
  const separator = " ".repeat(gutter);
  if (variant === "boxed") {
    const boxed = blocks.map((block, i) => boxCellBlock(block, contentWidths[i]));
    const boxWidths = contentWidths.map((w) => w + 4);
    return joinColumns(boxed, boxWidths, separator);
  }
  return joinColumns(blocks, contentWidths, separator);
}

/**
 * 自由摘要面板的格子容器:只负责呈现,不读取 Sample、不聚合 Metric。每个直接子节点
 * (数组 / Fragment 先按 ReportNode 规则展平,空分支不占格)是一格;`Col` 把多个区块
 * 归成一格。展平与 text 面排版的算术在 ./grid-layout.ts,这里只做两面结构适配。
 */
export const Grid = defineComponent<GridProps>({
  dimensions: () => ({}),
  web({ children, columns, variant, density, className }) {
    const normalized = normalizeGrid({ children, columns, variant, density });
    const style: CSSProperties = { "--nre-grid-max-columns": normalized.columns } as CSSProperties;
    return (
      <div
        className={cx("nre", "nre-grid", `nre-grid--${normalized.variant}`, `nre-grid--${normalized.density}`, className)}
        style={style}
      >
        {normalized.cells.map((cell) => (
          <div className="nre-grid-cell" key={cell.key}>
            {cell.node as ReactNode}
          </div>
        ))}
      </div>
    );
  },
  text({ children, columns, variant, density }, ctx) {
    const normalized = normalizeGrid({ children, columns, variant, density });
    if (normalized.cells.length === 0) return "";
    const plan = planTextGrid({
      availableWidth: ctx.width,
      cellCount: normalized.cells.length,
      columns: normalized.columns,
      density: normalized.density,
    });
    // 确定计划后才对每个 cell 调用一次 ctx.render——不为试探列数重复渲染。
    const blocks = normalized.cells.map((cell, i) => ctx.render(cell.node, plan.contentWidths[i % plan.columns]));
    const rows: string[] = [];
    for (let start = 0; start < blocks.length; start += plan.columns) {
      const rowBlocks = blocks.slice(start, start + plan.columns);
      const rowWidths = plan.contentWidths.slice(0, rowBlocks.length);
      rows.push(renderGridRow(rowBlocks, rowWidths, plan.gutter, normalized.variant));
    }
    return rows.join("\n\n");
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
function resolveStatDisplay(value: StatProps["value"], locale: ReportLocale): string {
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
      <div className={cx("nre", "nre-stat", `nre-stat--${tone}`, className)}>
        <div className="nre-stat-label">{resolveLocalizedText(label, ctx.locale)}</div>
        <div className="nre-stat-value">
          {isCellValue(value) && value.kind === "measure" ? (
            <MetricCellView cell={value.measure} attemptHref={ctx.attemptHref} locale={ctx.locale} />
          ) : isCellValue(value) ? (
            formatCellText(value, ctx.locale)
          ) : (
            resolveStatDisplay(value, ctx.locale)
          )}
        </div>
        {detail !== undefined ? <div className="nre-stat-detail">{resolveLocalizedText(detail, ctx.locale)}</div> : null}
      </div>
    );
  },
  text({ label, value, detail }, ctx) {
    const lines = [resolveLocalizedText(label, ctx.locale), resolveStatDisplay(value, ctx.locale)];
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
      <section className={cx("nre", "nre-section", className)}>
        {metaText !== undefined ? (
          <header className="nre-section-header">
            <h2 className="nre-section-title">{titleText}</h2>
            <p className="nre-section-meta">{metaText}</p>
          </header>
        ) : (
          <h2 className="nre-section-title">{titleText}</h2>
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

    const nested = ctx.sectionBoxedDepth > 0;
    if (nested) {
      // 横隔走结构化渲染期通道；不把哨兵塞进 text(): string，避免被 Row/Grid 改写或泄漏。
      ctx.collectPanelRow?.({ kind: "divider", title: heading, ...(metaText !== undefined ? { meta: metaText } : {}) });
    }
    // 外层 Section 已经把子树放进内容区；嵌套 Section 只登记横隔，不能再扣一次框宽。
    const contentWidth = nested ? ctx.width : panelContentWidth(ctx.width, "boxed");
    ctx.sectionBoxedDepth++;
    try {
      const rows: PanelRow[] = [];
      const priorCollector = ctx.collectPanelRow;
      ctx.collectPanelRow = (row) => rows.push(row);
      let body: string;
      try {
        body = childArray(children)
          .map((child) => ctx.render(child, contentWidth))
          .filter((block) => block.length > 0)
          .join("\n\n");
      } finally {
        ctx.collectPanelRow = priorCollector;
      }
      if (nested) {
        // 更深一层的横隔由本层收集后，继续上交给真正画框的祖先。
        for (const row of rows) priorCollector?.(row);
        return body;
      }
      return renderPanel({
        title: heading,
        meta: metaText,
        rows: [...rows, ...(body.length > 0 ? [{ kind: "line", text: body } satisfies PanelRow] : [])],
        width: ctx.width,
        mode: "boxed",
      }).join("\n");
    } finally {
      ctx.sectionBoxedDepth--;
    }
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
    return <p className={cx("nre", "nre-text", className)}>{children}</p>;
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
 * 配置对象形态的报告要全站样式优先用外壳 styles,两条通道注入同一增强层。
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
      <div className={cx("nre", "nre-tabs", className)} data-nre-tabs>
        {tabs.map((tab, i) => (
          <details key={i} className={cx("nre-tab", tab.className)} open={i === 0}>
            <summary className="nre-tab-title">{resolveLocalizedText(tab.title, ctx.locale)}</summary>
            <div className="nre-tab-body">{tab.children as ReactNode}</div>
          </details>
        ))}
      </div>
    );
  },
  text({ children }, ctx) {
    const tabs = tabEntries(children);
    return tabs
      .map((tab) => {
        const heading = resolveLocalizedText(tab.title, ctx.locale);
        const body = childArray(tab.children)
          .map((child) => ctx.render(child, ctx.width - 2))
          .filter((block) => block.length > 0)
          .join("\n\n");
        return body.length > 0 ? `${heading}\n${indentBlock(body, "  ")}` : heading;
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
    return <div className={cx("nre", "nre-tab-body", className)}>{children as ReactNode}</div>;
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
}

/** `<Column>` 结构节点:只携带 props,由 Table 解释。 */
export interface ColumnProps {
  dataKey: string;
  header?: LocalizedText;
  align?: "left" | "right";
  better?: "higher" | "lower";
  maxLines?: number;
}

export const Column = defineComponent<ColumnProps>({
  dimensions: () => ({}),
  web: () => null,
  text: () => "",
});
Column.displayName = "Column";

export interface TablePresentation {
  children?: ReportNode;
  sort?: string;
  filter?: boolean;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}

/**
 * Table props:新形态(source | data)与旧形态(columns + rows 字符串)并存。
 * 1.7 退场后只留 DataProps 两支。
 */
export type TableProps =
  | ({
      data: TableContent | Dataset | null;
      source?: never;
      input?: never;
      columns?: never;
      rows?: never;
    } & TablePresentation)
  | ({
      source: Source<SourceInput, TableContent | Dataset | null>;
      data?: never;
      input?: SourceInput;
      columns?: never;
      rows?: never;
    } & TablePresentation)
  | ({
      columns: readonly [TableColumn, ...TableColumn[]];
      rows: readonly TableRow[];
      data?: never;
      source?: never;
      input?: never;
      children?: never;
      sort?: never;
      filter?: never;
      attemptHref?: never;
    } & Pick<TablePresentation, "locale" | "className">);

function isLegacyTableProps(props: TableProps): props is Extract<TableProps, { columns: unknown }> {
  return Array.isArray((props as { columns?: unknown }).columns);
}

function columnNodesOf(children: ReportNode | undefined): ColumnProps[] {
  if (children === null || children === undefined || typeof children === "boolean") return [];
  const out: ColumnProps[] = [];
  const visit = (node: unknown): void => {
    if (node === null || node === undefined || typeof node === "boolean") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (typeof node === "object" && node !== null && "type" in node && "props" in node) {
      const el = node as { type: unknown; props: ColumnProps };
      if (el.type === Column) out.push(el.props);
    }
  };
  visit(children);
  return out;
}

function resolveTableContent(props: TableProps, locale: ReportLocale): {
  columns: TableColumn[];
  rows: TableRow[];
  content: TableContent | null;
} {
  if (isLegacyTableProps(props)) {
    return { columns: [...props.columns], rows: [...props.rows], content: null };
  }
  const raw = props.data ?? null;
  const content = raw === null ? null : isDataset(raw) ? datasetToTableContent(raw) : raw;
  if (content === null) return { columns: [], rows: [], content: null };
  const overrides = columnNodesOf(props.children);
  const specs: ColumnSpec[] = overrides.length > 0
    ? overrides.map((c) => ({ key: c.dataKey, better: c.better }))
    : [...content.columns];
  const headers = new Map(
    overrides.map((c) => [c.dataKey, c.header ?? c.dataKey] as const),
  );
  const aligns = new Map(overrides.map((c) => [c.dataKey, c.align] as const));
  const maxLines = new Map(overrides.map((c) => [c.dataKey, c.maxLines] as const));
  const flat = flattenTableContentForText(
    { columns: specs, rows: content.rows },
    locale,
  );
  const columns: TableColumn[] = specs.map((spec) => ({
    key: spec.key,
    header: headers.get(spec.key) ?? spec.key,
    align: aligns.get(spec.key) ?? (spec.better ? "right" : "left"),
    maxLines: maxLines.get(spec.key),
  }));
  if (columns.length === 0) return { columns: [], rows: [], content };
  return {
    columns: columns as [TableColumn, ...TableColumn[]],
    rows: flat.rows.map((r) => ({ key: r.key, cells: r.cells })),
    content,
  };
}

function validateResolvedTable(columns: TableColumn[], rows: TableRow[]): void {
  if (columns.length === 0) {
    throw new Error("Table needs at least one column: pass columns or a TableContent with columns, or <Column dataKey> children.");
  }
  const keys = new Set<string>();
  for (const column of columns) {
    if (keys.has(column.key)) {
      throw new Error(`Table column key "${column.key}" is declared twice — column keys address row.cells and must be unique. Rename one column.`);
    }
    keys.add(column.key);
  }
  const rowKeys = new Set<string>();
  for (const row of rows) {
    if (rowKeys.has(row.key)) {
      throw new Error(`Table row key "${row.key}" is declared twice — row keys are the row identity and must be unique.`);
    }
    rowKeys.add(row.key);
    for (const cellKey of Object.keys(row.cells)) {
      if (!keys.has(cellKey)) {
        throw new Error(
          `Table row "${row.key}" has a cell "${cellKey}" that no column declares. Declare the column in columns, or drop the stray cell.`,
        );
      }
    }
  }
}

function renderCellWeb(
  cell: Cell | undefined,
  ctx: { attemptHref?: (locator: AttemptLocator) => string; locale: ReportLocale },
): ReactNode {
  if (!cell) return <span className="nre-missing">{MISSING_MARK}</span>;
  switch (cell.kind) {
    case "notApplicable":
      return <span className="nre-missing">{MISSING_MARK}</span>;
    case "missing":
      return <span className="nre-missing">{cell.code}</span>;
    case "text":
      return (
        <span>
          {cell.text}
          {cell.detail ? <span className="nre-muted"> {cell.detail}</span> : null}
        </span>
      );
    case "locator":
      return ctx.attemptHref ? (
        <a className="nre-locator" href={ctx.attemptHref(cell.locator)}>
          {cell.locator}
        </a>
      ) : (
        <span className="nre-locator">{formatCellText(cell, ctx.locale)}</span>
      );
    case "summary":
    case "score":
    case "verdict":
      return formatCellText(cell, ctx.locale);
    case "measure":
      return <MetricCellView cell={cell.measure} attemptHref={ctx.attemptHref} locale={ctx.locale} />;
    default: {
      const _e: never = cell;
      return _e;
    }
  }
}

function renderContentRowsWeb(
  rows: readonly TableContentRow[],
  columns: readonly TableColumn[],
  ctx: { attemptHref?: (locator: AttemptLocator) => string; locale: ReportLocale },
  depth = 0,
): ReactNode[] {
  const out: ReactNode[] = [];
  for (const row of rows) {
    out.push(
      <tr key={row.key} className={row.variant === "placeholder" ? "nre-row-placeholder" : undefined} data-depth={depth || undefined}>
        {columns.map((column, i) => {
          const cell = row.cells[column.key];
          return (
            <td
              key={column.key}
              className={column.align === "right" ? "nre-align-right" : undefined}
              style={i === 0 && depth > 0 ? { paddingLeft: `${0.75 + depth * 1.25}rem` } : undefined}
            >
              {renderCellWeb(cell, ctx)}
            </td>
          );
        })}
      </tr>,
    );
    if (row.subRows?.length) out.push(...renderContentRowsWeb(row.subRows, columns, ctx, depth + 1));
  }
  return out;
}

/**
 * 行 × 列原语:新形态吃 TableContent(source/data + Cell + subRows + placeholder);
 * 旧形态 columns/rows 字符串格仍可用(faces.ts / 过渡测试)。
 */
export const Table = defineComponent<TableProps>({
  dimensions: () => ({}),
  web(props, ctx) {
    const locale = props.locale ?? ctx.locale;
    const resolved = resolveTableContent(props, locale);
    validateResolvedTable(resolved.columns, resolved.rows);
    const alignClass = (align?: ColumnAlign) => (align === "right" ? "nre-align-right" : undefined);
    const attemptHref = !isLegacyTableProps(props) ? props.attemptHref ?? ctx.attemptHref : ctx.attemptHref;
    if (resolved.content) {
      return (
        <table className={cx("nre", "nre-table", props.className)} data-filter={!isLegacyTableProps(props) && props.filter ? "true" : undefined}>
          <thead>
            <tr>
              {resolved.columns.map((column) => (
                <th key={column.key} scope="col" className={alignClass(column.align)}>
                  {resolveLocalizedText(column.header, locale)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{renderContentRowsWeb(resolved.content.rows, resolved.columns, { attemptHref, locale })}</tbody>
        </table>
      );
    }
    const { columns, rows, className } = { columns: resolved.columns, rows: resolved.rows, className: props.className };
    const hasLocator = rows.some((row) => row.locator !== undefined);
    return (
      <table className={cx("nre", "nre-table", className)}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={alignClass(column.align)}>
                {resolveLocalizedText(column.header, locale)}
              </th>
            ))}
            {hasLocator ? <th scope="col">{localeText(locale, "table.attempt")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {columns.map((column) => {
                const value = row.cells[column.key];
                const missing = value === null || value === undefined;
                return (
                  <td key={column.key} className={alignClass(column.align)}>
                    {missing ? <span className="nre-missing">{MISSING_MARK}</span> : value}
                  </td>
                );
              })}
              {hasLocator ? (
                <td>
                  {row.locator ? (
                    ctx.attemptHref ? (
                      <a className="nre-locator" href={ctx.attemptHref(row.locator)}>
                        {row.locator}
                      </a>
                    ) : (
                      <span className="nre-locator">{row.locator}</span>
                    )
                  ) : (
                    <span className="nre-missing">{MISSING_MARK}</span>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    );
  },
  text(props, ctx) {
    const locale = props.locale ?? ctx.locale;
    const resolved = resolveTableContent(props, locale);
    validateResolvedTable(resolved.columns, resolved.rows);
    return renderTableText(
      { columns: resolved.columns as [TableColumn, ...TableColumn[]], rows: resolved.rows, locale },
      ctx,
    );
  },
});
Table.displayName = "Table";

export { Waterfall, waterfallText } from "./primitives/waterfall.tsx";
export type { WaterfallContent, WaterfallNode, WaterfallProps, WaterfallRow } from "./primitives/waterfall.tsx";

export { Callouts } from "./primitives/callouts.tsx";
export type { CalloutGroup, CalloutItem, CalloutLevel, CalloutsProps } from "./primitives/callouts.tsx";
export { CopyBlock } from "./primitives/copy-block.tsx";
export type { CopyBlockContent, CopyBlockProps } from "./primitives/copy-block.tsx";

export { DiffView, diffViewText } from "./primitives/diff-view.tsx";
export type { DiffChange, DiffContent, DiffFile, DiffViewProps } from "./primitives/diff-view.tsx";

export { Conversation, ConversationEntries, conversationText, sanitizeConversationPreview } from "./primitives/conversation.tsx";
export type {
  ConversationContent,
  ConversationEntry,
  ConversationProps,
  ConversationTurn,
  FailedCommandContent,
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
