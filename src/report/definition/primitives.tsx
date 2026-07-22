// 排版原语 Row / Col / Grid / Section / Stat / Text / Style / Tabs / Tab / Table:十个内置
// 双面组件,没有特殊机制(docs/feature/reports/library/layout.md)。web 面是普通 React 渲染;
// text 面用 ctx.render(child, 子宽) 显式传宽。Style 注入页级全局 CSS(树位置只决定声明
// 顺序),text 面渲染为空。Table 是自定义表的标准件,官方表状组件的 text 面也建在它上面。
// Grid / Stat 的语义层(normalizeGrid 展平校验、text 面的 TextGridPlan 排版)在
// ./grid-layout.ts(docs/feature/reports/architecture.md「排版原语的语义层与面内布局」);
// 本文件只声明两面适配,不重复那份算术。

import type { CSSProperties, ReactNode } from "react";
import type { AttemptLocator } from "../../results/locator.ts";
import { COMPONENT_RAW_CHILDREN, COMPONENT_ROLE, defineComponent, type ReportNode } from "./tree.ts";
import { localeText, resolveLocalizedText, type LocalizedText, type ReportLocale } from "../model/locale.ts";
import { indentBlock, joinColumns, padDisplay, stringWidth, wrapDisplay } from "../model/text-layout.ts";
import type { ColumnAlign } from "../model/text-layout.ts";
import { encodeDividerLine, panelContentWidth, renderPanel, rowsFromBodyText } from "../model/panel.ts";
import { renderTableText } from "./table-text.ts";
import { normalizeGrid, planTextGrid, type GridDensity, type GridVariant } from "./grid-layout.ts";

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
 * 自由摘要面板的格子容器:只负责呈现,不读取 Scope、不聚合 Metric。每个直接子节点
 * (数组 / Fragment 先按 ReportNode 规则展平,空分支不占格)是一格;`Col` 把多个区块
 * 归成一格。展平与 text 面排版的算术在 ./grid-layout.ts,这里只做两面结构适配。
 */
export const Grid = defineComponent<GridProps>({
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
  /** 已格式化的主值;null 明确渲染为 —,不补成 0。 */
  value: LocalizedText | number | null;
  /** 主值下面的短解释;省略时不留空行。 */
  detail?: LocalizedText;
  /** 主值的语义色;不从正负号、单位或 Metric.better 猜。默认 neutral。 */
  tone?: StatTone;
  className?: string;
}

/**
 * Grid / Stat 共享的显示值规范化:LocalizedText 走 resolveLocalizedText,number 走当前
 * locale 的 Intl.NumberFormat,null 变 —;两个面调同一份,不各写一套。
 */
function resolveStatDisplay(value: LocalizedText | number | null, locale: ReportLocale): string {
  if (value === null) return MISSING_MARK;
  if (typeof value === "number") return new Intl.NumberFormat(locale).format(value);
  return resolveLocalizedText(value, locale);
}

/** label / 主值 / 辅助信息的最小内容单元;可以脱离 Grid 单独使用。 */
export const Stat = defineComponent<StatProps>({
  web({ label, value, detail, tone = "neutral", className }, ctx) {
    return (
      <div className={cx("nre", "nre-stat", `nre-stat--${tone}`, className)}>
        <div className="nre-stat-label">{resolveLocalizedText(label, ctx.locale)}</div>
        <div className="nre-stat-value">{resolveStatDisplay(value, ctx.locale)}</div>
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

// text 面的框线体裁(docs/feature/reports/library/layout.md「区域框」):顶层 Section 画完整
// 四边框,嵌在其中的 Section 降为横隔 `├─ ─┤`。「嵌套」按运行期调用栈深度判断(而不是静态树
// 结构),天然处理任意中间层(Row/Col/Grid/Tabs)——只在 boxed 模式下计数,plain 模式的嵌套
// 靠递归自然处理(每层各自加两格缩进),不需要这份计数。深度在 try/finally 里配对增减,
// 渲染是纯同步调用栈,不会跨 Section 泄漏。
let sectionBoxedDepth = 0;

/** 带标题的块:网页是标题层级(可选 meta 同行右对齐);终端面框线体裁全部委托给 panel.ts,
 *  这里只负责按 ctx.panelMode 组装 title/meta/rows 喂给它,不自己拼框字符。 */
export const Section = defineComponent<SectionProps>({
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

    const nested = sectionBoxedDepth > 0;
    const contentWidth = panelContentWidth(ctx.width, "boxed");
    sectionBoxedDepth++;
    try {
      const body = childArray(children)
        .map((child) => ctx.render(child, contentWidth))
        .filter((block) => block.length > 0)
        .join("\n\n");
      if (nested) {
        // 嵌套 Section 不再画自己的框,借字符串桥接把「这是一条横隔」的意图交给外层
        // (真正调用 renderPanel 的那个 Section);中间层(Row/Col/…)把它当普通文本块透传。
        const marker = encodeDividerLine(heading, metaText);
        return body.length > 0 ? `${marker}\n${body}` : marker;
      }
      return renderPanel({
        title: heading,
        meta: metaText,
        rows: rowsFromBodyText(body),
        width: ctx.width,
        mode: "boxed",
      }).join("\n");
    } finally {
      sectionBoxedDepth--;
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
      const element = node as { type: unknown; props: Record<string, unknown> };
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

/** 一列的定义:取哪个 cells 键、表头写什么、往哪边对齐。 */
export interface TableColumn {
  /** 取 `row.cells[key]` 的键。 */
  key: string;
  /** 表头文案,按渲染 locale 选择。 */
  header: LocalizedText;
  /** 对齐方向,默认 `"left"`;`"right"` 按显示宽度右对齐,数字列用。 */
  align?: ColumnAlign;
  /**
   * text 面:单元格折行后的最大物理行数,放不下的部分以 `…` 收口;省略则不限行数。
   * 摘要类列(如比较列表的 Result)用它保证「格子是可扫读的预览」;完整值在下钻面。
   * web 面不消费——网页的高度约束是组件自己的 CSS 决定。
   */
  maxLines?: number;
}

/** 一行的数据:身份键、已格式化的格子、可选的 attempt locator。 */
export interface TableRow {
  /** 行身份。 */
  key: string;
  /** 已格式化的显示值;`null`(或缺这个键)渲染成 `—`,不补 0。 */
  cells: Readonly<Record<string, string | null>>;
  /** 带上就多一列 attempt:web 面链到证据室,text 面列出 locator。 */
  locator?: AttemptLocator;
}

export interface TableProps {
  /** 非空列定义;数组顺序即渲染顺序。 */
  columns: readonly [TableColumn, ...TableColumn[]];
  /** 行数据;数组顺序即渲染顺序,组件不重排也不过滤。 */
  rows: readonly TableRow[];
  /** 组件自带文案(attempt 表头、丢列提示)的语言;省略时随宿主。 */
  locale?: ReportLocale;
  /** web 面挂到 `<table>` 上。 */
  className?: string;
}

/** 列 key 唯一、行 cells 不携带未声明 key、空列拒绝——无类型 JS 输入在渲染前同样校验。 */
function validateTableProps(props: TableProps): void {
  if (!Array.isArray(props.columns) || props.columns.length === 0) {
    throw new Error("Table needs at least one column: pass columns: [{ key, header }] — an empty column list renders nothing readable.");
  }
  const keys = new Set<string>();
  for (const column of props.columns) {
    if (keys.has(column.key)) {
      throw new Error(`Table column key "${column.key}" is declared twice — column keys address row.cells and must be unique. Rename one column.`);
    }
    keys.add(column.key);
  }
  const rowKeys = new Set<string>();
  for (const row of props.rows) {
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

/**
 * 自定义表的标准件:列由报告作者定,格子是算好的显示值,两个面各自排整齐。
 *
 * text 面列宽按**显示宽度**算(CJK / 全角记 2 列),所以中文列不会撕歪;总宽超过
 * `ctx.width` 时先折最宽的左对齐列(右对齐列是数字,折行读不了),压到下限仍放不下
 * 就从右侧丢列并在表下如实报丢了几列。web 面是 `<table>` + `<thead>` / `<tbody>`,
 * 右对齐落成 `nre-align-right` 类,不用内联样式。
 *
 * 官方的 `MetricTable` / `MetricMatrix` / `Scoreboard` / `DeltaTable` 的 text 面就建在
 * 这个组件上:自定义表和官方表用同一把尺子。
 */
export const Table = defineComponent<TableProps>({
  web(props, ctx) {
    validateTableProps(props);
    const { columns, rows, locale, className } = props;
    const chrome = locale ?? ctx.locale;
    const hasLocator = rows.some((row) => row.locator !== undefined);
    const alignClass = (align?: ColumnAlign) => (align === "right" ? "nre-align-right" : undefined);
    return (
      <table className={cx("nre", "nre-table", className)}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={alignClass(column.align)}>
                {resolveLocalizedText(column.header, chrome)}
              </th>
            ))}
            {hasLocator ? <th scope="col">{localeText(chrome, "table.attempt")}</th> : null}
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
    validateTableProps(props);
    return renderTableText(props, ctx);
  },
});
Table.displayName = "Table";
