// cases: docs/engineering/testing/unit/reports.md
// 分区「Table 与文本排版原语」:Grid 展平规则、columns 校验与 TextGridPlan 的宽度算术
// 直接对 normalizeGrid / planTextGrid 断言,不经渲染面或 HTML。

import { describe, expect, it } from "vitest";
import { normalizeGrid, planTextGrid, validateGridColumns } from "./grid-layout.ts";
import type { ReportElement } from "./tree.ts";

const FRAGMENT = Symbol.for("react.fragment");

function el(type: string, props: globalThis.Record<string, unknown> = {}): ReportElement {
  return { type, props };
}

describe("validateGridColumns", () => {
  it("接受有限正整数", () => {
    expect(validateGridColumns(1)).toBe(1);
    expect(validateGridColumns(9)).toBe(9);
  });

  for (const bad of [0, -1, 1.5, NaN, Infinity, -Infinity]) {
    it(`拒绝 ${bad} 并给出完整用户反馈`, () => {
      expect(() => validateGridColumns(bad)).toThrowError(/columns/i);
      try {
        validateGridColumns(bad);
      } catch (err) {
        const message = (err as Error).message;
        expect(message).toContain(JSON.stringify(bad));
        expect(message).toContain("columns={N}");
      }
    });
  }
});

describe("normalizeGrid", () => {
  it("展平数组与 Fragment、跳过空分支,任意 ReportNode 各占一格", () => {
    const a = el("Stat", { label: "a" });
    const b = el("Stat", { label: "b" });
    const c = el("Col", { children: [el("Stat", { label: "c1" }), el("Stat", { label: "c2" })] });
    const children = [
      a,
      null,
      undefined,
      false,
      { type: FRAGMENT, props: { children: [b, null] } },
      c,
    ];
    const normalized = normalizeGrid({ children, columns: 3 });
    expect(normalized.cells.map((cell) => cell.node)).toEqual([a, b, c]);
    // Col 归拢的两个 Stat 仍是同一格,不下钻展开成两格
    expect(normalized.cells).toHaveLength(3);
  });

  it("全部子节点为空分支时 0 格", () => {
    const normalized = normalizeGrid({ children: [null, undefined, false], columns: 3 });
    expect(normalized.cells).toHaveLength(0);
  });

  it("variant / density 默认 plain / regular", () => {
    const normalized = normalizeGrid({ children: el("Stat"), columns: 1 });
    expect(normalized.variant).toBe("plain");
    expect(normalized.density).toBe("regular");
  });

  it("单个裸元素(非数组)也能展平为一格并生成稳定 key", () => {
    const normalized = normalizeGrid({ children: el("Stat", { label: "solo" }), columns: 1 });
    expect(normalized.cells).toHaveLength(1);
    expect(normalized.cells[0].key).toBe("niceeval-grid-cell-0");
  });
});

describe("planTextGrid", () => {
  // 与 docs/feature/reports/library/layout.md 的运行总览示例逐字核对:Section 缩进后
  // Grid 收到 98 显示列可用宽度,两个 Grid 都必须恰好降到三列且逐行不超过 100(=98+2 缩进)。
  it("目标示例 Grid(columns=6, 6 cell, regular)在 98 可用宽度降为三列,内容宽 28/27/27", () => {
    const plan = planTextGrid({ availableWidth: 98, cellCount: 6, columns: 6, density: "regular" });
    expect(plan.columns).toBe(3);
    expect(plan.contentWidths).toEqual([28, 27, 27]);
    expect(plan.gutter).toBe(2);
    const rowWidth = plan.contentWidths.reduce((sum, w) => sum + w + 4, 0) + plan.gutter * (plan.columns - 1);
    expect(rowWidth).toBe(98);
  });

  it("目标示例 Grid(columns=9, 9 cell, compact)在 98 可用宽度降为三列,内容宽 28/28/28", () => {
    const plan = planTextGrid({ availableWidth: 98, cellCount: 9, columns: 9, density: "compact" });
    expect(plan.columns).toBe(3);
    expect(plan.contentWidths).toEqual([28, 28, 28]);
    expect(plan.gutter).toBe(1);
    const rowWidth = plan.contentWidths.reduce((sum, w) => sum + w + 4, 0) + plan.gutter * (plan.columns - 1);
    expect(rowWidth).toBe(98);
  });

  it("继续收窄宽度时降为一列(无条件 fallback,即使内容宽度小于 24)", () => {
    const plan = planTextGrid({ availableWidth: 20, cellCount: 6, columns: 6, density: "regular" });
    expect(plan.columns).toBe(1);
    expect(plan.contentWidths).toEqual([16]); // 20 - BOXED_OVERHEAD_PER_CELL(4)
  });

  it("columns=1 时无条件单列,不因宽度充裕而尝试更多列", () => {
    const plan = planTextGrid({ availableWidth: 200, cellCount: 6, columns: 1, density: "regular" });
    expect(plan.columns).toBe(1);
  });

  it("列数不超过 min(declared columns, cellCount)", () => {
    const plan = planTextGrid({ availableWidth: 400, cellCount: 2, columns: 9, density: "regular" });
    expect(plan.columns).toBeLessThanOrEqual(2);
  });

  it("plain 与 boxed 复用同一份 plan:规划不吃 variant,列数与内容宽只随 columns/density/availableWidth 变化", () => {
    const a = planTextGrid({ availableWidth: 98, cellCount: 6, columns: 6, density: "regular" });
    const b = planTextGrid({ availableWidth: 98, cellCount: 6, columns: 6, density: "regular" });
    expect(a).toEqual(b);
  });

  it("整除余数从左向右各补一列,行宽不超过 availableWidth", () => {
    const plan = planTextGrid({ availableWidth: 100, cellCount: 4, columns: 4, density: "regular" });
    const rowWidth = plan.contentWidths.reduce((sum, w) => sum + w + 4, 0) + plan.gutter * (plan.columns - 1);
    expect(rowWidth).toBeLessThanOrEqual(100);
    // 余数只补到最左侧若干列,不累积到行尾
    for (let i = 1; i < plan.contentWidths.length; i++) {
      expect(plan.contentWidths[i]).toBeLessThanOrEqual(plan.contentWidths[i - 1]);
    }
  });
});
