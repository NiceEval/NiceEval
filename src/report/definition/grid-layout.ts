// Grid 的语义层与面内布局(docs/feature/reports/README.md「排版原语的语义层与面内布局」、
// docs/feature/reports/README.md「换列规则」)。只放同步纯函数与中间类型:
// normalizeGrid 把 resolved ReportNode children 展平成有序 cell 列表;balanceColumns /
// planGridColumns / planTextGrid 是两面同源的列数算术,几何常量只在这里出现一次
// ——Grid 不收列数、边框或体量参数,这些全从格数与可用宽度算。不 import show / view、
// Record IO 或 stylesheet;primitives.tsx 消费本文件产出两面适配。

import type { ReportNode } from "./tree.ts";
import { dataBoxBorder } from "../model/panel.ts";

// react/jsx-runtime 的 Fragment 注册符号,跨 react 版本稳定(tree.ts 同一常量的独立取用,
// Symbol.for 全局注册表保证同一符号,不产生耦合)。
const REACT_FRAGMENT = Symbol.for("react.fragment");

function isElementNode(node: unknown): node is { type: unknown; props: globalThis.Record<string, unknown>; key?: unknown } {
  return typeof node === "object" && node !== null && !Array.isArray(node) && "type" in node && "props" in node;
}

function keyOf(node: unknown, fallback: string): string {
  if (isElementNode(node)) {
    const key = node.key;
    if (typeof key === "string" || typeof key === "number") return String(key);
  }
  return fallback;
}

export interface NormalizedGridCell {
  readonly node: ReportNode;
  /** React key:复用元素自带 key,缺失时按展平后的声明序生成稳定回退。 */
  readonly key: string;
}

/**
 * `normalizeGrid` 的产物:有序、不可拆的 cell 列表。
 * 不是公开 data shape,也不进结果或 artifact——只是两个渲染面共享的同步排版中间值。
 */
export interface NormalizedGrid {
  readonly cells: readonly NormalizedGridCell[];
}

/**
 * 递归展开数组与 Fragment、跳过空分支(null/undefined/boolean),其余节点各占一格
 * ——`Col` 归拢的多个子节点、任意自定义组件的渲染结果都是不透明的一格,不下钻其内部结构。
 */
function flattenGridChildren(children: ReportNode): NormalizedGridCell[] {
  const cells: NormalizedGridCell[] = [];
  const visit = (node: ReportNode): void => {
    if (node === null || node === undefined || typeof node === "boolean") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (isElementNode(node) && node.type === REACT_FRAGMENT) {
      visit(node.props.children as ReportNode);
      return;
    }
    cells.push({ node, key: keyOf(node, `niceeval-grid-cell-${cells.length}`) });
  };
  visit(children);
  return cells;
}

/** `Grid` 组件创建时的一次性规范化:展平 children 成有序 cell 列表。 */
export function normalizeGrid(input: { children: ReportNode }): NormalizedGrid {
  return { cells: flattenGridChildren(input.children) };
}

/**
 * 换列规则第 2 步:给定格数与容量列数,按行数摊匀。
 * 行数 = ⌈格数/容量⌉,列数 = ⌈格数/行数⌉;结果从不超过容量列数。
 */
export function balanceColumns(cellCount: number, capacityColumns: number): number {
  const cells = Math.max(1, cellCount);
  const capacity = Math.max(1, Math.min(capacityColumns, cells));
  const rows = Math.ceil(cells / capacity);
  return Math.ceil(cells / rows);
}

/**
 * web 面几何常量:最小格宽与格线宽度,@container 断点与 stylesheet 共用这一份。
 * `comfortableCellWidth` 不参与换列,只是 stylesheet 里体量插值的上端——实际格宽涨到它时
 * 格内留白与 Stat 主值字号到顶。
 */
export const WEB_GRID_GEOMETRY = {
  minCellWidth: 160,
  separator: 1,
  comfortableCellWidth: 220,
} as const;

export interface GridColumnStep {
  readonly columns: number;
  /** 该列数下每格仍不低于最小格宽时的起始容器宽度(px)。 */
  readonly minWidth: number;
}

/**
 * 换列阶梯:候选列数是 ⌈格数/行数⌉ 去重,起始宽度 = 列数 × 最小格宽 + (列数-1) × 格线宽。
 * 按列数升序——web 面据此生成 @container 规则时,较大断点写在后面以覆盖较小断点。
 */
export function planGridColumns(cellCount: number): readonly GridColumnStep[] {
  const n = Math.max(0, cellCount);
  if (n === 0) return [];
  const { minCellWidth, separator } = WEB_GRID_GEOMETRY;
  const seen = new Set<number>();
  const steps: GridColumnStep[] = [];
  for (let rows = 1; rows <= n; rows++) {
    const columns = Math.ceil(n / rows);
    if (seen.has(columns)) continue;
    seen.add(columns);
    steps.push({
      columns,
      minWidth: columns * minCellWidth + (columns - 1) * separator,
    });
  }
  return steps.sort((a, b) => a.columns - b.columns);
}

/**
 * web 面随身 `@container` 规则文本:格数的纯函数——同格数逐字相同。基线一列写在
 * stylesheet;这里只发 ≥2 列的断点。规则只声明列数(`--grid-columns` 供体量插值取用),
 * 不出现留白或字号的具体值。末行恰一格时附带 `grid-column: 1 / -1`。
 */
export function gridContainerRules(cellCount: number): string {
  const parts: string[] = [];
  for (const { columns, minWidth } of planGridColumns(cellCount)) {
    if (columns < 2) continue;
    const selector = `.niceeval-grid[data-cells="${cellCount}"]`;
    const lone =
      cellCount % columns === 1
        ? ` ${selector} > .niceeval-grid-cell:last-child { grid-column: 1 / -1; }`
        : "";
    parts.push(
      `@container niceeval-grid (min-width: ${minWidth}px) { ${selector} { --grid-columns: ${columns}; grid-template-columns: repeat(${columns}, minmax(0, 1fr)); }${lone} }`,
    );
  }
  return parts.join("\n");
}

/** text 面规划的输入:只有可用宽度与 cell 数。 */
export interface TextGridPlanInput {
  readonly availableWidth: number;
  readonly cellCount: number;
}

/**
 * text 面的一次性排版计划:实际列数、每列内容显示宽度、孤格铺满用的整行内容宽。
 * 格线之外不画外框,所以每行的显示宽度恰好是 `availableWidth`。
 */
export interface TextGridPlan {
  readonly columns: number;
  readonly contentWidths: readonly number[];
  /** 末行只剩一格时该格的内容显示宽度(= availableWidth,整行都归它)。 */
  readonly fullRowContentWidth: number;
}

/** text 面每 cell 的最小可读内容宽度:列数宁可少,也不以挤坏字段换取更多列。 */
const MIN_CONTENT_WIDTH = 24;
/** 相邻两格之间那条格线连同两侧留白占的显示列(` │ `)。 */
export const TEXT_GRID_SEPARATOR = " │ ";

/**
 * 从格数向一列尝试,选出满足每格最小可读内容宽度的最大列数作为容量,再按行数摊匀;
 * 一列是无条件 fallback(即使内容宽度因此小于 24)。选定列数后,余下的显示列从左向右
 * 逐列多补一列,因此任意一行的显示宽度都恰好是 `availableWidth`。
 */
export function planTextGrid(input: TextGridPlanInput): TextGridPlan {
  const { availableWidth, cellCount } = input;
  const separator = TEXT_GRID_SEPARATOR.length;
  const cells = Math.max(1, cellCount);

  let capacity = 1;
  for (let n = cells; n >= 2; n--) {
    const budget = availableWidth - separator * (n - 1);
    if (budget >= 0 && Math.floor(budget / n) >= MIN_CONTENT_WIDTH) {
      capacity = n;
      break;
    }
  }

  const chosen = balanceColumns(cells, capacity);

  const budget = Math.max(0, availableWidth - separator * (chosen - 1));
  const base = Math.floor(budget / chosen);
  const remainder = budget - base * chosen;
  const contentWidths = Array.from({ length: chosen }, (_, i) => Math.max(1, base + (i < remainder ? 1 : 0)));

  return { columns: chosen, contentWidths, fullRowContentWidth: Math.max(1, availableWidth) };
}

/**
 * 两行之间那条行间线:上一行 `above` 格、下一行 `below` 格,列宽取自同一份计划。
 * 两行都有的列边界画 `┼`,只有上一行有的(末行变短)收成 `┴`——末行左对齐、不拉伸,
 * 所以它的列边界总是上一行的前缀。
 */
export function textGridRowSeparator(
  contentWidths: readonly number[],
  above: number,
  below: number,
): string {
  // 物理字符由数据格框的单一渲染件产出(docs/cli.md「终端框线:一个渲染件,全仓消费」);
  // 这里只决定「上一行有几格、下一行有几格」这份格几何。
  return dataBoxBorder("rule", contentWidths.slice(0, above), false, below);
}
