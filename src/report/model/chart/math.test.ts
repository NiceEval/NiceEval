// cases: docs/engineering/testing/unit/reports.md
// 分区「MetricScatter 点标签布局(web 面)」:对 placePointLabels 直接断言标签框与点框的几何关系,不经 HTML。

import { describe, expect, it } from "vitest";
import {
  axisScale,
  paddedAxisDomain,
  placePointLabels,
  ticksInDomain,
  type LabelBounds,
  type PlacedPointLabel,
  type PointLabelInput,
} from "./math.ts";

const BOUNDS: LabelBounds = { x0: 2, y0: 2, x1: 638, y1: 358 };
const WIDTH = 90;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// 与契约声明的标签框一致:基线上方 10px、下方 2px,锚向决定水平延伸方向
function labelBox(l: PlacedPointLabel, width: number): Box {
  const x0 = l.anchor === "start" ? l.x : l.anchor === "end" ? l.x - width : l.x - width / 2;
  return { x0, y0: l.y - 10, x1: x0 + width, y1: l.y + 2 };
}

function dotBox(p: PointLabelInput): Box {
  return { x0: p.cx - 6, y0: p.cy - 6, x1: p.cx + 6, y1: p.cy + 6 };
}

function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

describe("placePointLabels", () => {
  it("近重合点簇:标签框两两不叠、不压任何数据点(只向下推的级联会把第三个标签推到下方点上)", () => {
    // 三点近重合 + 右下方另一点:down-only 布局把第三个标签推到 y∈[122,134]、x≥310,
    // 正好压住 (330,128) 的点框;候选位择优必须避开
    const points: PointLabelInput[] = [
      { cx: 300, cy: 100, width: WIDTH },
      { cx: 303, cy: 102, width: WIDTH },
      { cx: 298, cy: 104, width: WIDTH },
      { cx: 330, cy: 128, width: WIDTH },
    ];
    const labels = placePointLabels(points, BOUNDS);
    const boxes = labels.map((l) => labelBox(l, WIDTH));

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlaps(boxes[i], boxes[j]), `标签 ${i} 与标签 ${j} 重叠`).toBe(false);
      }
      for (let j = 0; j < points.length; j++) {
        expect(overlaps(boxes[i], dotBox(points[j])), `标签 ${i} 压住点 ${j}`).toBe(false);
      }
    }
    // 离开左右紧邻位的标签必须带 leader 标记,渲染层据此连回原点
    for (let i = 0; i < labels.length; i++) {
      const adjacent =
        labels[i].y === points[i].cy + 4 &&
        ((labels[i].anchor === "start" && labels[i].x === points[i].cx + 10) ||
          (labels[i].anchor === "end" && labels[i].x === points[i].cx - 10));
      expect(labels[i].leader, `标签 ${i} 的 leader 标记与位置不符`).toBe(!adjacent);
    }
  });

  it("无冲突取右侧紧邻位不带 leader;右缘点锚到左侧紧邻位且标签框不越出画布", () => {
    const sparse = placePointLabels(
      [
        { cx: 100, cy: 100, width: WIDTH },
        { cx: 400, cy: 250, width: WIDTH },
      ],
      BOUNDS,
    );
    for (const [i, l] of sparse.entries()) {
      expect(l.anchor).toBe("start");
      expect(l.x).toBe([100, 400][i] + 10);
      expect(l.leader).toBe(false);
    }

    const [edge] = placePointLabels([{ cx: 630, cy: 200, width: WIDTH }], BOUNDS);
    const box = labelBox(edge, WIDTH);
    expect(edge.anchor).toBe("end");
    expect(edge.leader).toBe(false);
    expect(box.x0).toBeGreaterThanOrEqual(BOUNDS.x0);
    expect(box.x1).toBeLessThanOrEqual(BOUNDS.x1);
    expect(box.y0).toBeGreaterThanOrEqual(BOUNDS.y0);
    expect(box.y1).toBeLessThanOrEqual(BOUNDS.y1);
  });
});

// 分区「图轴值域」:对 paddedAxisDomain / axisScale 直接断言扩后的 [min, max],
// 不经渲染(docs/feature/reports/components/charts/README.md「值域」)。

describe("paddedAxisDomain", () => {
  it("两端各扩数据跨度的 20%:数据极值不落在域端点上", () => {
    // 跨度 10,20% = 2;其它比例或非对称实现会给出不同的 [9, 21] / [8, 20] 等,能被这条区分
    expect(paddedAxisDomain([10, 20])).toEqual([8, 22]);
  });

  it("零跨度 fallback:非零值取该值绝对值的 20%", () => {
    // 单点 8:margin = |8| × 0.2 = 1.6,与「值为 0 取 1」的分支必须走不同代码路径
    expect(paddedAxisDomain([8])).toEqual([6.4, 9.6]);
    expect(paddedAxisDomain([-8, -8])).toEqual([-9.6, -6.4]);
  });

  it("零跨度 fallback:值恰为 0 时取 1(而不是 |0| × 20% = 0 的退化边距)", () => {
    expect(paddedAxisDomain([0])).toEqual([-1, 1]);
  });

  it("声明了 bounds 的一端:扩展截到边界为止,贴边数据点如实落在框线上,余量推到另一端", () => {
    // 通过率贴到 100%:数据 [0.8, 1] 边距后 [0.76, 1](max 钳制),跨度 0.24 < 下限 1/3,
    // 补足时 hi 被 1 顶住,余量全部推向 lo → [2/3, 1],跨度恰为下限
    const [lo1, hi1] = paddedAxisDomain([0.8, 1], { min: 0, max: 1 });
    expect(lo1).toBeCloseTo(2 / 3);
    expect(hi1).toBe(1);
    // 贴到 0:数据 [0, 0.2] 边距后 [0, 0.24](min 钳制),补足时余量推向 hi → [0, 1/3]
    const [lo2, hi2] = paddedAxisDomain([0, 0.2], { min: 0, max: 1 });
    expect(lo2).toBe(0);
    expect(hi2).toBeCloseTo(1 / 3);
  });

  it("聚集数据扩到最小跨度下限:bounds 全量程的 1/3,以数据为中心对称补足", () => {
    // 数据 [0.73, 0.83] 边距后 [0.71, 0.85] 跨度 0.14 < 1/3,两侧各补 (1/3 − 0.14)/2
    const [lo, hi] = paddedAxisDomain([0.73, 0.83], { min: 0, max: 1 });
    expect(lo).toBeCloseTo(0.71 - (1 / 3 - 0.14) / 2);
    expect(hi).toBeCloseTo(0.85 + (1 / 3 - 0.14) / 2);
    expect(hi - lo).toBeCloseTo(1 / 3);
  });

  it("数据跨度本就不小于下限时,值域不受下限影响", () => {
    // 数据 [0.2, 0.9] 边距后 [0.06, 1](max 钳制),跨度 0.94 ≥ 1/3,原样返回
    const [lo, hi] = paddedAxisDomain([0.2, 0.9], { min: 0, max: 1 });
    expect(lo).toBeCloseTo(0.06);
    expect(hi).toBe(1);
  });

  it("bounds 只声明一端(如 costUSD 的 { min: 0 })时,量程参考取声明端到数据另一侧极值", () => {
    // 参考 = dataHi − 0 = 120,下限 40;边距后 [96, 124] 跨度 28,两侧各补 6 → [90, 130]
    expect(paddedAxisDomain([100, 120], { min: 0 })).toEqual([90, 130]);
    // 数据跨度相对量程足够大时下限不触发:[40, 120] 边距后 [24, 136] 跨度 112 ≥ 40
    expect(paddedAxisDomain([40, 120], { min: 0 })).toEqual([24, 136]);
  });

  it("无 bounds 的轴(如 MetricLine 的 NumericAxis)只扩边距,不钳制——即使数据跨越常见的自然边界", () => {
    // 不传 bounds 参数:与「声明了 bounds」的钳制路径必须走不同分支,数据可以跨到 0 以外
    const [lo, hi] = paddedAxisDomain([-5, -1]);
    expect(lo).toBeCloseTo(-5.8);
    expect(hi).toBeCloseTo(-0.2);
  });
});

describe("ticksInDomain", () => {
  it("刻度只在值域内取值,不像经典 nice-numbers 算法那样向外扩张出假刻度", () => {
    const ticks = ticksInDomain(8, 22, 5);
    expect(ticks.every((t) => t >= 8 && t <= 22)).toBe(true);
    expect(ticks.length).toBeGreaterThan(0);
  });

  it("域退化为单点时返回该点", () => {
    expect(ticksInDomain(5, 5)).toEqual([5]);
  });
});

describe("axisScale", () => {
  it("反向轴先扩边距再反向:invert 只改变像素映射方向,不改变值域推定结果", () => {
    const values = [10, 20];
    const bounds = { min: 0 };
    const normal = axisScale(values, bounds, 0, 100, false);
    const inverted = axisScale(values, bounds, 0, 100, true);
    // 值域(用刻度间接验证,ticksInDomain 是值域的纯函数)必须相同——反向不重新推定值域
    expect(inverted.ticks).toEqual(normal.ticks);
    // 但映射方向相反:数据下界在 normal 中落在像素下界,在 inverted 中落在像素上界
    expect(normal.scale(8)).toBeCloseTo(0);
    expect(normal.scale(22)).toBeCloseTo(100);
    expect(inverted.scale(8)).toBeCloseTo(100);
    expect(inverted.scale(22)).toBeCloseTo(0);
  });

  it("bounds 钳制在 invert 下同样生效(反向只翻转映射,不绕过钳制)", () => {
    const scale = axisScale([0.8, 1], { min: 0, max: 1 }, 0, 100, true);
    // 值域被钳制 + 下限补足为 [2/3, 1](见 paddedAxisDomain 测试);反向后值域上界(1)映射到像素下界
    expect(scale.scale(1)).toBeCloseTo(0);
    expect(scale.scale(2 / 3)).toBeCloseTo(100);
  });
});
