// Grid 的语义层与面内布局(docs/feature/reports/architecture.md「排版原语的语义层与面内布局」、
// docs/feature/reports/library/layout.md「换列规则」)。只放同步纯函数与中间类型:
// normalizeGrid 把 resolved ReportNode children 展平成有序 cell 列表;balanceColumns /
// planGridColumns / planTextGrid 是两面同源的列数算术。不 import show / view、Record IO
// 或 stylesheet;primitives.tsx 消费本文件产出两面适配。

import type { ReportNode } from "./tree.ts";

export type GridVariant = "plain" | "boxed";
export type GridDensity = "regular" | "compact";

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
 * `normalizeGrid` 的产物:有序、不可拆的 cell 列表 + variant / density。
 * 不是公开 data shape,也不进结果或 artifact——只是两个渲染面共享的同步排版中间值。
 */
export interface NormalizedGrid {
  readonly cells: readonly NormalizedGridCell[];
  readonly variant: GridVariant;
  readonly density: GridDensity;
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
export function normalizeGrid(input: {
  children: ReportNode;
  variant?: GridVariant;
  density?: GridDensity;
}): NormalizedGrid {
  return {
    cells: flattenGridChildren(input.children),
    variant: input.variant ?? "plain",
    density: input.density ?? "regular",
  };
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

/** web 面 density 几何常量:最小格宽与格间距;CSS 变量与 @container 断点共用这一份。 */
export const WEB_GRID_GEOMETRY = {
  regular: { minCellWidth: 220, gap: 20 },
  compact: { minCellWidth: 160, gap: 10 },
} as const satisfies Record<GridDensity, { minCellWidth: number; gap: number }>;

export interface GridColumnStep {
  readonly columns: number;
  /** 该列数下每格仍不低于最小格宽时的起始容器宽度(px)。 */
  readonly minWidth: number;
}

/**
 * 换列阶梯:候选列数是 ⌈格数/行数⌉ 去重,起始宽度 = 列数 × 最小格宽 + (列数-1) × 格间距。
 * 按列数升序——web 面据此生成 @container 规则时,较大断点写在后面以覆盖较小断点。
 */
export function planGridColumns(cellCount: number, density: GridDensity): readonly GridColumnStep[] {
  const n = Math.max(0, cellCount);
  if (n === 0) return [];
  const { minCellWidth, gap } = WEB_GRID_GEOMETRY[density];
  const seen = new Set<number>();
  const steps: GridColumnStep[] = [];
  for (let rows = 1; rows <= n; rows++) {
    const columns = Math.ceil(n / rows);
    if (seen.has(columns)) continue;
    seen.add(columns);
    steps.push({
      columns,
      minWidth: columns * minCellWidth + (columns - 1) * gap,
    });
  }
  return steps.sort((a, b) => a.columns - b.columns);
}

/**
 * web 面随身 `@container` 规则文本:(格数, density) 的纯函数——同一组合逐字相同。
 * 基线一列写在 stylesheet;这里只发 ≥2 列的断点。末行恰一格时附带 `grid-column: 1 / -1`。
 */
export function gridContainerRules(cellCount: number, density: GridDensity): string {
  const densityClass = `niceeval-grid--${density}`;
  const parts: string[] = [];
  for (const { columns, minWidth } of planGridColumns(cellCount, density)) {
    if (columns < 2) continue;
    const selector = `.${densityClass}[data-cells="${cellCount}"]`;
    const lone =
      cellCount % columns === 1
        ? ` ${selector} > .niceeval-grid-cell:last-child { grid-column: 1 / -1; }`
        : "";
    parts.push(
      `@container niceeval-grid (min-width: ${minWidth}px) { ${selector} { grid-template-columns: repeat(${columns}, minmax(0, 1fr)); }${lone} }`,
    );
  }
  return parts.join("\n");
}

/** text 面规划的输入:只有可用宽度、cell 数与 density。 */
export interface TextGridPlanInput {
  readonly availableWidth: number;
  readonly cellCount: number;
  readonly density: GridDensity;
}

/**
 * text 面的一次性排版计划:实际列数、每列内容显示宽度、格间 gutter、孤格铺满用的整行内容宽。
 * `boxed` 与 `plain` 复用同一份计划(规划总是先扣 boxed 的四边框与内 padding),
 * `plain` 渲染时只是不打印这部分字符——两个 variant 因此列数一致,不会各挑各的列数。
 */
export interface TextGridPlan {
  readonly columns: number;
  readonly contentWidths: readonly number[];
  readonly gutter: number;
  /** 末行只剩一格时该格的内容显示宽度(= availableWidth − boxed 单格开销)。 */
  readonly fullRowContentWidth: number;
}

/** text 面每 cell 的最小可读内容宽度;density 不以挤坏字段换取更多列。 */
const MIN_CONTENT_WIDTH = 24;
/** boxed 单 cell 的固定开销:左右各一根边框 + 左右各一格 padding。 */
const BOXED_OVERHEAD_PER_CELL = 4;

function gridGutter(density: GridDensity): number {
  return density === "compact" ? 1 : 2;
}

/**
 * 从格数向一列尝试,选出满足每格最小可读内容宽度的最大列数作为容量,再按行数摊匀;
 * 一列是无条件 fallback(即使内容宽度因此小于 24)。选定列数后,余下的显示列从左向右
 * 逐列多补一列,因此任意一行的显示宽度都不会超过 `availableWidth`(见调用方组装)。
 */
export function planTextGrid(input: TextGridPlanInput): TextGridPlan {
  const { availableWidth, cellCount, density } = input;
  const gutter = gridGutter(density);
  const cells = Math.max(1, cellCount);

  let capacity = 1;
  for (let n = cells; n >= 2; n--) {
    const budget = availableWidth - BOXED_OVERHEAD_PER_CELL * n - gutter * (n - 1);
    if (budget >= 0 && Math.floor(budget / n) >= MIN_CONTENT_WIDTH) {
      capacity = n;
      break;
    }
  }

  const chosen = balanceColumns(cells, capacity);

  const budget = Math.max(0, availableWidth - BOXED_OVERHEAD_PER_CELL * chosen - gutter * (chosen - 1));
  const base = Math.floor(budget / chosen);
  const remainder = budget - base * chosen;
  const contentWidths = Array.from({ length: chosen }, (_, i) => Math.max(1, base + (i < remainder ? 1 : 0)));
  const fullRowContentWidth = Math.max(1, availableWidth - BOXED_OVERHEAD_PER_CELL);

  return { columns: chosen, contentWidths, gutter, fullRowContentWidth };
}
