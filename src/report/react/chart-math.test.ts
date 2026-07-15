// cases: docs/engineering/unit-tests/reports/cases.md
// 分区「MetricScatter 点标签布局(web 面)」:对 placePointLabels 直接断言标签框与点框的几何关系,不经 HTML。

import { describe, expect, it } from "vitest";
import { placePointLabels, type LabelBounds, type PlacedPointLabel, type PointLabelInput } from "./chart-math.ts";

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
