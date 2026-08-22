// boxed Section 的运行期状态通道（text 渲染同步、单页单栈）。
// TextContext 是冻结值；Section 嵌套降横隔、Grid/Table 判断外框仍需要贯穿一次遍历的
// boxed 深度与最近外层横隔收集器。这里以模块级同步状态保存它们，Section.text 用
// try/finally 成对进出，确保子树返回时状态已还原。

import type { PanelRow } from "../../model/panel.ts";

interface TextPanelState {
  /** 当前 boxed Section 深度(顶层 0);plain 体裁不参与。 */
  sectionBoxedDepth: number;
  /** 最近外层 Section 的横隔收集器;嵌套 Section 经它登记 divider。 */
  collectPanelRow: ((row: PanelRow) => void) | undefined;
}

const state: TextPanelState = { sectionBoxedDepth: 0, collectPanelRow: undefined };

/** 当前 boxed Section 的运行期深度。 */
export function panelSectionDepth(): number {
  return state.sectionBoxedDepth;
}

/** 在 `fn` 期间把 boxed 深度推高一层;返回时还原。 */
export function withPanelSectionDepth<Value>(depth: number, fn: () => Value): Value {
  const previous = state.sectionBoxedDepth;
  state.sectionBoxedDepth = depth;
  try {
    return fn();
  } finally {
    state.sectionBoxedDepth = previous;
  }
}

/** 向最近外层 Section 登记一条结构化横隔;没有外层时是空操作。 */
export function emitPanelRow(row: PanelRow): void {
  state.collectPanelRow?.(row);
}

/** 在 `fn` 期间挂上横隔收集器;返回时还原(嵌套 Section 挂自己的收集器再上交给祖先)。 */
export function withPanelRowCollector<Value>(collector: (row: PanelRow) => void, fn: () => Value): Value {
  const previous = state.collectPanelRow;
  state.collectPanelRow = collector;
  try {
    return fn();
  } finally {
    state.collectPanelRow = previous;
  }
}
