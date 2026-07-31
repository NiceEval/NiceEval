// cases: docs/engineering/testing/unit/reports.md
// 「Grid 的换列规则」:摊匀、容量上界、孤格铺满、text 降列、web 规则文本纯函数。
// 断言面是列数纯函数产出、text 输出字符串与 web HTML,不经浏览器。

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  balanceColumns,
  gridContainerRules,
  normalizeGrid,
  planGridColumns,
  planTextGrid,
  TEXT_GRID_SEPARATOR,
  WEB_GRID_GEOMETRY,
} from "./grid-layout.ts";
import type { ReportElement } from "./tree.ts";
import { createTextContext, renderNodeToText, runWithWebContext, type WebContext } from "./tree.ts";
import { Grid, Stat } from "./primitives.tsx";
import { stringWidth } from "../model/text-layout.ts";
import { UndeclaredDimensionValueError } from "../presentation.ts";

const FRAGMENT = Symbol.for("react.fragment");

function el(type: string, props: globalThis.Record<string, unknown> = {}): ReportElement {
  return { type, props };
}

const webCtx: WebContext = {
  locale: "en",
  href: () => undefined,
  dimension: () => {
    throw new UndeclaredDimensionValueError("unbound", "_");
  },
};

function renderGridHtml(node: React.ReactNode): string {
  return runWithWebContext(webCtx, () => renderToStaticMarkup(node as never));
}

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
    const normalized = normalizeGrid({ children });
    expect(normalized.cells.map((cell) => cell.node)).toEqual([a, b, c]);
    expect(normalized.cells).toHaveLength(3);
  });

  it("全部子节点为空分支时 0 格", () => {
    const normalized = normalizeGrid({ children: [null, undefined, false] });
    expect(normalized.cells).toHaveLength(0);
  });

  it("单个裸元素(非数组)也能展平为一格并生成稳定 key", () => {
    const normalized = normalizeGrid({ children: el("Stat", { label: "solo" }) });
    expect(normalized.cells).toHaveLength(1);
    expect(normalized.cells[0].key).toBe("niceeval-grid-cell-0");
  });
});

describe("balanceColumns", () => {
  it("6 格 / 容量 5 → 3(区分力:摊匀区别于容量本身)", () => {
    expect(balanceColumns(6, 5)).toBe(3);
  });

  it("7 格 / 容量 5 → 4(不整除)", () => {
    expect(balanceColumns(7, 5)).toBe(4);
  });

  it("摊匀后的列数从不超过容量列数", () => {
    for (const cells of [1, 2, 3, 4, 5, 6, 7, 8, 9, 12]) {
      for (let capacity = 1; capacity <= 12; capacity++) {
        expect(balanceColumns(cells, capacity)).toBeLessThanOrEqual(Math.min(capacity, cells));
      }
    }
  });
});

describe("planGridColumns", () => {
  it("6 格的候选列与起始宽度", () => {
    const { minCellWidth, separator } = WEB_GRID_GEOMETRY;
    const steps = planGridColumns(6);
    expect(steps.map((s) => s.columns)).toEqual([1, 2, 3, 6]);
    for (const step of steps) {
      expect(step.minWidth).toBe(step.columns * minCellWidth + (step.columns - 1) * separator);
    }
    expect(steps.find((s) => s.columns === 2)?.minWidth).toBe(321);
    expect(steps.find((s) => s.columns === 3)?.minWidth).toBe(482);
    expect(steps.find((s) => s.columns === 6)?.minWidth).toBe(965);
  });
});

describe("gridContainerRules", () => {
  it("同格数的两个 Grid 规则文本逐字相同", () => {
    expect(gridContainerRules(6)).toBe(gridContainerRules(6));
    expect(gridContainerRules(7)).toBe(gridContainerRules(7));
  });

  it("断点等于该列数的最小格宽合计;每条断点声明 --grid-columns;末行恰一格时附带铺满", () => {
    const rules = gridContainerRules(7);
    expect(rules).toContain("@container niceeval-grid (min-width: 482px)");
    expect(rules).toContain("repeat(3, minmax(0, 1fr))");
    expect(rules).toContain("--grid-columns: 3;");
    // 7 % 3 === 1 → 3 列断点下末格铺满
    expect(rules).toMatch(
      /min-width: 482px\)[\s\S]*niceeval-grid-cell:last-child \{ grid-column: 1 \/ -1; \}/,
    );
    // 7 % 4 === 3 → 4 列断点不铺满
    const fourColBlock = rules.split("@container").find((block) => block.includes("repeat(4,"));
    expect(fourColBlock).toBeDefined();
    expect(fourColBlock).not.toContain("grid-column:");
  });

  it("体量不落在随身规则里:留白与字号一个都不出现,只声明列数", () => {
    const rules = gridContainerRules(9);
    expect(rules).not.toMatch(/padding|font-size|clamp/);
    expect(rules).toContain("--grid-columns:");
  });
});

describe("planTextGrid", () => {
  /** 一行的显示宽度:各列内容宽 + 列间格线。格线之外不画外框,所以它恰好是可用宽度。 */
  function rowWidth(plan: { contentWidths: readonly number[]; columns: number }): number {
    return (
      plan.contentWidths.reduce((sum, w) => sum + w, 0) +
      TEXT_GRID_SEPARATOR.length * (plan.columns - 1)
    );
  }

  it("文档示例 Grid(6 格)在 96 可用宽度降为三列,内容宽 30/30/30", () => {
    const plan = planTextGrid({ availableWidth: 96, cellCount: 6 });
    expect(plan.columns).toBe(3);
    expect(plan.contentWidths).toEqual([30, 30, 30]);
    expect(rowWidth(plan)).toBe(96);
  });

  it("文档示例 Grid(9 格)在同一宽度上同样三列——列数只看格数与可用宽度", () => {
    const plan = planTextGrid({ availableWidth: 96, cellCount: 9 });
    expect(plan.columns).toBe(3);
    expect(plan.contentWidths).toEqual([30, 30, 30]);
    expect(rowWidth(plan)).toBe(96);
  });

  it("宽度不够时逐级降列,最窄无条件一列", () => {
    const plan = planTextGrid({ availableWidth: 20, cellCount: 6 });
    expect(plan.columns).toBe(1);
    expect(plan.contentWidths).toEqual([20]);
  });

  it("容量不足时摊匀:6 格在只能装 5 列的宽度上排成 3 列", () => {
    // 每格内容 ≥24:5 列要 W ≥ 24*5+3*4 = 132,6 列要 W ≥ 24*6+3*5 = 159 → 容量 5 → 摊匀成 3
    const plan = planTextGrid({ availableWidth: 140, cellCount: 6 });
    expect(plan.columns).toBe(3);
  });

  it("列数不超过格数", () => {
    const plan = planTextGrid({ availableWidth: 400, cellCount: 2 });
    expect(plan.columns).toBeLessThanOrEqual(2);
  });

  it("整除余数从左向右各补一列,行宽恰好是 availableWidth", () => {
    const plan = planTextGrid({ availableWidth: 100, cellCount: 4 });
    expect(rowWidth(plan)).toBe(100);
    for (let i = 1; i < plan.contentWidths.length; i++) {
      expect(plan.contentWidths[i]).toBeLessThanOrEqual(plan.contentWidths[i - 1]);
    }
  });
});

describe("孤格铺满与短末行", () => {
  function gridText(cells: number, width: number): string {
    return renderNodeToText(
      <Grid>
        {Array.from({ length: cells }, (_, i) => (
          <Stat key={i} label={`L${i}`} value={String(i)} />
        ))}
      </Grid>,
      createTextContext({ width }),
    );
  }

  function boxedGridText(cells: number, width: number): string {
    return renderNodeToText(
      <Grid>
        {Array.from({ length: cells }, (_, i) => (
          <Stat key={i} label={`L${i}`} value={String(i)} />
        ))}
      </Grid>,
      createTextContext({ width, panelMode: "boxed" }),
    );
  }

  it("text:boxed 时画数据格框——外框 ╭┬╮/╰┴╯,行间线交点 ┼,末行变短的边界收成 ┴", () => {
    // 每格 ≥24:框占 4 列后 4 列要 W ≥ 109,5 列要 W ≥ 136 → 容量 4 → balance(7,4) 仍是 4 → 4+3
    const text = boxedGridText(7, 120);
    const lines = text.split("\n");
    expect(lines[0]!.startsWith("╭")).toBe(true);
    expect(lines[0]!.endsWith("╮")).toBe(true);
    expect(lines[0]!.split("┬")).toHaveLength(4);
    expect(lines.at(-1)!.startsWith("╰")).toBe(true);
    expect(lines.at(-1)!.endsWith("╯")).toBe(true);
    // 行间线:上一行 4 格、下一行 3 格 → 前两个边界是 ┼,第三个收成 ┴
    const rule = lines.find((line) => line.includes("┼"))!;
    expect(rule.startsWith("├")).toBe(true);
    expect(rule.endsWith("┤")).toBe(true);
    expect(rule.split("┼")).toHaveLength(3);
    expect(rule.split("┴")).toHaveLength(2);
    // 所有行同宽:右边框对齐成一条直线。宽度贴合内容,不铺满终端
    const widths = new Set(lines.map((line) => stringWidth(line)));
    expect(widths.size).toBe(1);
    expect([...widths][0]!).toBeLessThan(120);
  });

  it("text:末行不足一整行时最后一格吃掉剩余宽度(只剩一格就是铺满整行)", () => {
    // 3 列容量 → balance(7,3)=3 → 3+3+1,末行是孤格
    const lone = boxedGridText(7, 100).split("\n");
    // 孤格那一行只有外框那两条竖线,没有列边界
    const loneRow = lone.filter((line) => line.includes("L6"))[0]!;
    expect(loneRow.split("│")).toHaveLength(3);
    // 短末行不止一格:4+3,末行最后一格补满右侧空出来的宽度,框仍是矩形
    const short = boxedGridText(7, 120).split("\n");
    const shortRow = short.filter((line) => line.includes("L4"))[0]!;
    // 3 格 → 两条列边界加两条外框竖线;末行与其余行同宽,框仍是矩形
    expect(shortRow.split("│")).toHaveLength(5);
    expect(stringWidth(shortRow)).toBe(stringWidth(short[0]!));
  });

  it("text:plain 体裁下格线整体消失,只按列对齐、行间空一行", () => {
    const text = gridText(7, 120);
    expect(text).not.toMatch(/[╭╮╰╯│├┤┬┴┼]/);
    expect(text).toContain("L0");
    expect(text).toContain("L6");
    expect(text.split("\n").some((line) => line === "")).toBe(true);
  });

  it("web:结构含 grid-fit / data-cells / 随身规则;孤格断点带 grid-column", () => {
    const html = renderGridHtml(
      <Grid>
        {Array.from({ length: 7 }, (_, i) => (
          <Stat key={i} label={`L${i}`} value={String(i)} />
        ))}
      </Grid>,
    );
    expect(html).toContain('class="niceeval-report niceeval-grid-fit"');
    expect(html).toContain('data-cells="7"');
    expect(html).toContain("@container niceeval-grid");
    expect(html).toContain("grid-column: 1 / -1");
    // 短末行不拉伸:规则里没有给「非孤格」断点写 last-child span
    const fourColBlock = html.split("@container").find((block) => block.includes("repeat(4,"));
    expect(fourColBlock).toBeDefined();
    expect(fourColBlock).not.toContain("grid-column:");
  });
});
