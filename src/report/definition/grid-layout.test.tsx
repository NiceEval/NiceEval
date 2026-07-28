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
  WEB_GRID_GEOMETRY,
} from "./grid-layout.ts";
import type { ReportElement } from "./tree.ts";
import { createTextContext, renderNodeToText, runWithWebContext, type WebContext } from "./tree.ts";
import { Grid, Stat } from "./primitives.tsx";
import { UndeclaredDimensionValueError } from "../presentation.ts";

const FRAGMENT = Symbol.for("react.fragment");

function el(type: string, props: globalThis.Record<string, unknown> = {}): ReportElement {
  return { type, props };
}

const webCtx: WebContext = {
  locale: "en",
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

  it("variant / density 默认 plain / regular", () => {
    const normalized = normalizeGrid({ children: el("Stat") });
    expect(normalized.variant).toBe("plain");
    expect(normalized.density).toBe("regular");
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
  it("6 格 regular 的候选列与起始宽度", () => {
    const { minCellWidth, gap } = WEB_GRID_GEOMETRY.regular;
    const steps = planGridColumns(6, "regular");
    expect(steps.map((s) => s.columns)).toEqual([1, 2, 3, 6]);
    for (const step of steps) {
      expect(step.minWidth).toBe(step.columns * minCellWidth + (step.columns - 1) * gap);
    }
    expect(steps.find((s) => s.columns === 2)?.minWidth).toBe(460);
    expect(steps.find((s) => s.columns === 3)?.minWidth).toBe(700);
    expect(steps.find((s) => s.columns === 6)?.minWidth).toBe(1420);
  });
});

describe("gridContainerRules", () => {
  it("同格数同 density 的两个 Grid 规则文本逐字相同", () => {
    expect(gridContainerRules(6, "regular")).toBe(gridContainerRules(6, "regular"));
    expect(gridContainerRules(7, "compact")).toBe(gridContainerRules(7, "compact"));
  });

  it("断点等于该列数的最小格宽合计;末行恰一格时附带铺满", () => {
    const rules = gridContainerRules(7, "regular");
    expect(rules).toContain("@container niceeval-grid (min-width: 700px)");
    expect(rules).toContain('repeat(3, minmax(0, 1fr))');
    // 7 % 3 === 1 → 3 列断点下末格铺满
    expect(rules).toMatch(
      /min-width: 700px\)[\s\S]*niceeval-grid-cell:last-child \{ grid-column: 1 \/ -1; \}/,
    );
    // 7 % 4 === 3 → 4 列断点不铺满
    const fourColBlock = rules.split("@container").find((block) => block.includes("repeat(4,"));
    expect(fourColBlock).toBeDefined();
    expect(fourColBlock).not.toContain("grid-column");
  });
});

describe("planTextGrid", () => {
  it("目标示例 Grid(6 cell, regular)在 98 可用宽度降为三列,内容宽 28/27/27", () => {
    const plan = planTextGrid({ availableWidth: 98, cellCount: 6, density: "regular" });
    expect(plan.columns).toBe(3);
    expect(plan.contentWidths).toEqual([28, 27, 27]);
    expect(plan.gutter).toBe(2);
    const rowWidth = plan.contentWidths.reduce((sum, w) => sum + w + 4, 0) + plan.gutter * (plan.columns - 1);
    expect(rowWidth).toBe(98);
  });

  it("目标示例 Grid(9 cell, compact)在 98 可用宽度降为三列,内容宽 28/28/28", () => {
    const plan = planTextGrid({ availableWidth: 98, cellCount: 9, density: "compact" });
    expect(plan.columns).toBe(3);
    expect(plan.contentWidths).toEqual([28, 28, 28]);
    expect(plan.gutter).toBe(1);
    const rowWidth = plan.contentWidths.reduce((sum, w) => sum + w + 4, 0) + plan.gutter * (plan.columns - 1);
    expect(rowWidth).toBe(98);
  });

  it("宽度不够时逐级降列,最窄无条件一列", () => {
    const plan = planTextGrid({ availableWidth: 20, cellCount: 6, density: "regular" });
    expect(plan.columns).toBe(1);
    expect(plan.contentWidths).toEqual([16]);
  });

  it("容量不足时摊匀:6 格在只能装 5 列的宽度上排成 3 列", () => {
    // 5 列刚好够(每格内容 ≥24)、6 列不够 → 容量 5 → 摊匀成 3
    // budget_5 = W - 4*5 - 2*4 ≥ 24*5 → W ≥ 20+8+120 = 148
    // budget_6 = W - 4*6 - 2*5 ≥ 24*6 → W ≥ 24+10+144 = 178
    const plan = planTextGrid({ availableWidth: 160, cellCount: 6, density: "regular" });
    expect(plan.columns).toBe(3);
  });

  it("列数不超过格数", () => {
    const plan = planTextGrid({ availableWidth: 400, cellCount: 2, density: "regular" });
    expect(plan.columns).toBeLessThanOrEqual(2);
  });

  it("整除余数从左向右各补一列,行宽不超过 availableWidth", () => {
    const plan = planTextGrid({ availableWidth: 100, cellCount: 4, density: "regular" });
    const rowWidth = plan.contentWidths.reduce((sum, w) => sum + w + 4, 0) + plan.gutter * (plan.columns - 1);
    expect(rowWidth).toBeLessThanOrEqual(100);
    for (let i = 1; i < plan.contentWidths.length; i++) {
      expect(plan.contentWidths[i]).toBeLessThanOrEqual(plan.contentWidths[i - 1]);
    }
  });
});

describe("孤格铺满与短末行", () => {
  it("text:末行只剩一格时铺满整行;短末行不止一格时按列宽左对齐不拉伸", () => {
    // 7 格、容量足够排 4 列 → 4+3;末行 3 格不拉伸
    const wide = renderNodeToText(
      <Grid variant="boxed">
        {Array.from({ length: 7 }, (_, i) => (
          <Stat key={i} label={`L${i}`} value={String(i)} />
        ))}
      </Grid>,
      createTextContext({ width: 200 }),
    );
    const wideRows = wide.split("\n\n");
    expect(wideRows).toHaveLength(2);
    // 末行 3 个 box,不是 1 个铺满
    expect(wideRows[1].split("┌").length - 1).toBe(3);

    // 5 格、3 列 → 3+1+1? balance(5,3)= rows=ceil(5/3)=2, cols=ceil(5/2)=3 → 3+2
    // 需要末行恰 1 格:balance 后 columns 满足 cellCount % columns === 1
    // 4 格容量 3 → balance(4,3)=2 → 2+2,不是孤格
    // 5 格容量 2 → balance(5,2)=3 → 3+2
    // 7 格容量 3 → balance(7,3)=3 → 3+3+1 孤格!
    const lone = renderNodeToText(
      <Grid variant="boxed">
        {Array.from({ length: 7 }, (_, i) => (
          <Stat key={i} label={`L${i}`} value={String(i)} />
        ))}
      </Grid>,
      // 3 列容量:与上面 planTextGrid 98→3 同档,略放宽仍不够 4 列
      createTextContext({ width: 110 }),
    );
    const loneRows = lone.split("\n\n");
    expect(loneRows).toHaveLength(3);
    expect(loneRows[2].split("┌").length - 1).toBe(1);
    // 孤格顶边长度 = 整行可用宽(110),即 ┌ + ─×(110-2) + ┐
    const top = loneRows[2].split("\n")[0];
    expect(top.length).toBe(110);
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
    expect(html).not.toMatch(/repeat\(4,[\s\S]*grid-column/);
  });
});
