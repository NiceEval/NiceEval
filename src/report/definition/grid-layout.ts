// Grid 的语义层与面内布局(docs/feature/reports/architecture.md「排版原语的语义层与面内布局」、
// docs/feature/reports/library/layout.md「Grid 与 Stat」)。只放同步纯函数与中间类型:
// normalizeGrid 把 resolved ReportNode children 校验并展平成有序 cell 列表;planTextGrid
// 只依赖 availableWidth / cell 数 / 规范化 Grid props,规划 text 面的列数与每列宽度。
// 不 import show / view、Record IO 或 stylesheet;primitives.tsx 消费本文件产出两面适配。

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

/** 校验 `columns`:必须是有限正整数——TypeScript 的 `number` 排除不了 0/负数/小数/NaN/Infinity。 */
export function validateGridColumns(columns: number): number {
  if (!(Number.isFinite(columns) && Number.isInteger(columns) && columns > 0)) {
    throw new Error(
      `Grid columns must be a finite positive integer, received ${JSON.stringify(columns)}. ` +
        "Pass columns={N} with a whole number greater than 0 (e.g. columns={3}).",
    );
  }
  return columns;
}

export interface NormalizedGridCell {
  readonly node: ReportNode;
  /** React key:复用元素自带 key,缺失时按展平后的声明序生成稳定回退。 */
  readonly key: string;
}

/**
 * `normalizeGrid` 的产物:有序、不可拆的 cell 列表 + columns / variant / density。
 * 不是公开 data shape,也不进结果或 artifact——只是两个渲染面共享的同步排版中间值。
 */
export interface NormalizedGrid {
  readonly cells: readonly NormalizedGridCell[];
  readonly columns: number;
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
    cells.push({ node, key: keyOf(node, `nre-grid-cell-${cells.length}`) });
  };
  visit(children);
  return cells;
}

/** `Grid` 组件创建时的一次性规范化:校验 props、展平 children 成有序 cell 列表。 */
export function normalizeGrid(input: {
  children: ReportNode;
  columns: number;
  variant?: GridVariant;
  density?: GridDensity;
}): NormalizedGrid {
  return {
    cells: flattenGridChildren(input.children),
    columns: validateGridColumns(input.columns),
    variant: input.variant ?? "plain",
    density: input.density ?? "regular",
  };
}

/** text 面规划的输入:只有可用宽度、cell 数与规范化 Grid props 里跟宽度有关的两项。 */
export interface TextGridPlanInput {
  readonly availableWidth: number;
  readonly cellCount: number;
  readonly columns: number;
  readonly density: GridDensity;
}

/**
 * text 面的一次性排版计划:实际列数、每列内容显示宽度、格间 gutter。
 * `boxed` 与 `plain` 复用同一份计划(规划总是先扣 boxed 的四边框与内 padding),
 * `plain` 渲染时只是不打印这部分字符——两个 variant 因此列数一致,不会各挑各的列数。
 */
export interface TextGridPlan {
  readonly columns: number;
  readonly contentWidths: readonly number[];
  readonly gutter: number;
}

/** text 面每 cell 的最小可读内容宽度;density 不以挤坏字段换取更多列。 */
const MIN_CONTENT_WIDTH = 24;
/** boxed 单 cell 的固定开销:左右各一根边框 + 左右各一格 padding。 */
const BOXED_OVERHEAD_PER_CELL = 4;

function gridGutter(density: GridDensity): number {
  return density === "compact" ? 1 : 2;
}

/**
 * 从 `min(columns, cellCount)` 向一列尝试,选出满足每格最小可读内容宽度的最大列数;
 * 一列是无条件 fallback(即使内容宽度因此小于 24)。选定列数后,余下的显示列从左向右
 * 逐列多补一列,因此任意一行的显示宽度都不会超过 `availableWidth`(见调用方组装)。
 */
export function planTextGrid(input: TextGridPlanInput): TextGridPlan {
  const { availableWidth, cellCount, columns, density } = input;
  const gutter = gridGutter(density);
  const maxColumns = Math.max(1, Math.min(columns, Math.max(cellCount, 1)));

  let chosen = 1;
  for (let n = maxColumns; n >= 2; n--) {
    const budget = availableWidth - BOXED_OVERHEAD_PER_CELL * n - gutter * (n - 1);
    if (budget >= 0 && Math.floor(budget / n) >= MIN_CONTENT_WIDTH) {
      chosen = n;
      break;
    }
  }

  const budget = Math.max(0, availableWidth - BOXED_OVERHEAD_PER_CELL * chosen - gutter * (chosen - 1));
  const base = Math.floor(budget / chosen);
  const remainder = budget - base * chosen;
  const contentWidths = Array.from({ length: chosen }, (_, i) => Math.max(1, base + (i < remainder ? 1 : 0)));

  return { columns: chosen, contentWidths, gutter };
}
