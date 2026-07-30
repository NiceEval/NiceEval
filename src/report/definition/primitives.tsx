// 排版原语 Row / Col / Grid / Section / Stat / Text / Markdown / Style / Tabs / Tab / Table:十一个内置
// 双面组件,没有特殊机制(docs/feature/reports/library/layout.md)。web 面是普通 React 渲染;
// text 面用 ctx.render(child, 子宽) 显式传宽。Style 注入页级全局 CSS(树位置只决定声明
// 顺序),text 面渲染为空。Table 是自定义表的标准件,官方表状组件的 text 面也建在它上面。
// Grid / Stat 的语义层(normalizeGrid 展平校验、text 面的 TextGridPlan 排版)在
// ./grid-layout.ts(docs/feature/reports/architecture.md「排版原语的语义层与面内布局」);
// 本文件只声明两面适配,不重复那份算术。

import type { CSSProperties, ReactNode } from "react";
import type { AttemptLocator } from "../../record/locator.ts";
import {
  COMPONENT_RAW_CHILDREN,
  COMPONENT_ROLE,
  defineComponent,
  type ReportComponent,
  type ReportNode,
} from "./tree.ts";
import { localeText, resolveLocalizedText, type LocalizedText, type ReportLocale } from "../model/locale.ts";
import { indentBlock, joinColumns, padDisplay, stringWidth, wrapDisplay } from "../model/text-layout.ts";
import type { ColumnAlign } from "../model/text-layout.ts";
import { panelContentWidth, renderPanel, type PanelRow } from "../model/panel.ts";
import { renderTableText } from "./table-text.ts";
import {
  gridContainerRules,
  normalizeGrid,
  planTextGrid,
  textGridRowSeparator,
  TEXT_GRID_SEPARATOR,
} from "./grid-layout.ts";
import type { Dataset } from "../model/types.ts";
import { datasetToTableContent, isDataset } from "../model/dataset.ts";
import { isMetricValue, type MetricValue } from "../model/calculation.ts";
import {
  flattenTableContentForText,
  formatCellText,
  type Cell,
  type ColumnSpec,
  type TableContent,
  type TableContentRow,
} from "./cell.ts";
import { MetricCellView } from "../components/cell.tsx";
import { verdictMark } from "../model/format.ts";


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
    return <div className={cx("niceeval-report", "niceeval-col", className)}>{children as ReactNode}</div>;
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
    return <div className={cx("niceeval-report", "niceeval-row", className)}>{children as ReactNode}</div>;
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
    const plan = planTextGrid({ availableWidth: ctx.width, cellCount: normalized.cells.length });
    // 确定计划后才对每个 cell 调用一次 ctx.render——不为试探列数重复渲染。
    // 孤格铺满整行:末行只剩一格时用 fullRowContentWidth,其余短末行按各列宽左对齐不拉伸。
    const cellWidths = normalized.cells.map((_, i) => {
      const col = i % plan.columns;
      const isLastRowLone =
        plan.columns > 1 &&
        i === normalized.cells.length - 1 &&
        normalized.cells.length % plan.columns === 1;
      return isLastRowLone ? plan.fullRowContentWidth : plan.contentWidths[col];
    });
    const blocks = normalized.cells.map((cell, i) => ctx.render(cell.node, cellWidths[i]));
    // 行与行之间是一条行间线,不是空行——格线要连起来才读成一片面板。
    const out: string[] = [];
    for (let start = 0; start < blocks.length; start += plan.columns) {
      const rowBlocks = blocks.slice(start, start + plan.columns);
      const rowWidths = cellWidths.slice(start, start + rowBlocks.length);
      if (start > 0) out.push(textGridRowSeparator(plan.contentWidths, plan.columns, rowBlocks.length));
      out.push(joinColumns(rowBlocks, rowWidths, TEXT_GRID_SEPARATOR));
    }
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
            ? renderCellWeb(value, { attemptHref: ctx.attemptHref, locale: ctx.locale, showMeasureRefs: false })
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
}

export interface TablePresentation {
  sort?: string;
  searchable?: boolean;
  attemptHref?: (locator: AttemptLocator) => string;
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

/** 官方组合组件内部的富 Cell 适配面；不从 niceeval/report 导出。 */
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
    const sample = rows.map((row) => row[spec.field]).find(isMetricValue);
    return {
      key: spec.field,
      ...(sample?.unit !== undefined ? { unit: sample.unit } : {}),
      ...(sample?.better !== undefined ? { better: sample.better } : {}),
    };
  });
  const contentRows: TableContentRow[] = rows.map((row, index) => {
    const refs = row.refs;
    const key =
      typeof row.key === "string"
        ? row.key
        : Array.isArray(refs) && typeof refs[0] === "string"
          ? refs[0]
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
 * (docs/feature/reports/components/primitives/table.md「Content 协议」)。
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

function renderCellWeb(
  cell: Cell | undefined,
  ctx: { attemptHref?: (locator: AttemptLocator) => string; locale: ReportLocale; showMeasureRefs?: boolean },
): ReactNode {
  if (!cell) return <span className="niceeval-missing">{MISSING_MARK}</span>;
  switch (cell.kind) {
    case "notApplicable":
      return <span className="niceeval-missing">{MISSING_MARK}</span>;
    case "missing":
      return <span className="niceeval-missing">{formatCellText(cell, ctx.locale)}</span>;
    case "text":
      return (
        <span className="niceeval-cell-text">
          <span>{cell.text}</span>
          {cell.detail ? <small className="niceeval-cell-detail">{cell.detail}</small> : null}
        </span>
      );
    case "locator": {
      // 判定长在 locator 上:判定符与语义色同场,不靠颜色单独表意
      // (docs/feature/reports/components/summaries/experiment-table.md)。
      const verdict = cell.verdict;
      const className = verdict === undefined ? "niceeval-locator" : `niceeval-locator niceeval-verdict-${verdict}`;
      const mark = verdict === undefined ? null : (
        <span className="niceeval-locator-mark" aria-hidden="true">
          {verdictMark(verdict === "skipped" ? "unreadable" : verdict)}
        </span>
      );
      return ctx.attemptHref ? (
        <a className={className} href={ctx.attemptHref(cell.locator)}>
          {mark}
          {cell.locator}
        </a>
      ) : (
        <span className={className}>{formatCellText(cell, ctx.locale)}</span>
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
                {cell.counts![kind]} {localeText(ctx.locale, `verdict.${kind === "skipped" ? "unreadable" : kind}`)}
              </span>
            ))}
            {parts.length === 0 ? <span className="niceeval-missing">{MISSING_MARK}</span> : null}
          </span>
        );
      }
      const verdict = cell.verdict ?? "skipped";
      // 判定符走 verdictMark 单源,与 locator 格同一张表(errored 是 `!`,不并到 `✗`)。
      return (
        <span className={`niceeval-verdict niceeval-verdict-${verdict}`}>
          {verdictMark(verdict === "skipped" ? "unreadable" : verdict)}{" "}
          {localeText(ctx.locale, `verdict.${verdict === "skipped" ? "unreadable" : verdict}`)}
        </span>
      );
    }
    case "metric":
      return (
        <MetricCellView
          cell={cell.metric}
          attemptHref={ctx.showMeasureRefs === false ? undefined : ctx.attemptHref}
          locale={ctx.locale}
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
    attemptHref?: (locator: AttemptLocator) => string;
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
  ctx: { attemptHref?: (locator: AttemptLocator) => string; locale: ReportLocale },
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
    const attemptHref = props.attemptHref ?? ctx.attemptHref;
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
                  attemptHref,
                  locale,
                  showMeasureRefs: false,
                })}
              </td>
            </tr>
          </tbody>
        ) : (
          <tbody>{renderFlatContentRowsWeb(content.rows, columns, { attemptHref, locale })}</tbody>
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
      { columns, rows: flat.rows.map((row) => ({ key: row.key, cells: row.cells })), locale },
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

export { Waterfall, waterfallText } from "./primitives/waterfall.tsx";
export type { WaterfallContent, WaterfallNode, WaterfallProps, WaterfallRow } from "./primitives/waterfall.tsx";

export { Callouts } from "./primitives/callouts.tsx";
export type { CalloutGroup, CalloutItem, CalloutLevel, CalloutsProps } from "./primitives/callouts.tsx";
export { CopyBlock } from "./primitives/copy-block.tsx";
export type { CopyBlockContent, CopyBlockProps } from "./primitives/copy-block.tsx";

export { DiffView, diffViewText } from "./primitives/diff-view.tsx";
export type { DiffChange, DiffContent, DiffFile, DiffFileWindow, DiffViewProps } from "./primitives/diff-view.tsx";

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
export { Scatter, Line, Bars, Area, applyBarsSortLimit } from "./primitives/marks.tsx";
export type {
  ScatterProps,
  ExternalScatterProps,
  LineProps,
  ExternalLineProps,
  BarsProps,
  ExternalBarsProps,
  BarsSort,
  AreaProps,
  ExternalAreaProps,
} from "./primitives/marks.tsx";
export { pointsToDataset } from "./primitives/points-dataset.ts";
export type { ExternalPoint, PointsChartFields } from "./primitives/points-dataset.ts";
