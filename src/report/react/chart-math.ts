// 通用图表数值工具:round-number 刻度生成与点标签布局,零依赖纯函数。

function niceNumber(range: number, round: boolean): number {
  if (range <= 0) return 1;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * 10 ** exponent;
}

/** [min, max] 区间上生成 count 个左右的“整齐”刻度(Heckbert nice-numbers)。 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const range = niceNumber(max - min, false);
  const step = niceNumber(range / Math.max(1, count - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

export interface PointLabelInput {
  cx: number;
  cy: number;
  /** 标签文本的估算宽度(px)。 */
  width: number;
}

/** 标签允许占用的画布范围(含坐标轴边距,标签可以借用空白边距)。 */
export interface LabelBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PlacedPointLabel {
  /** <text> 的锚点坐标(y 为文字基线)。 */
  x: number;
  y: number;
  anchor: "start" | "end" | "middle";
  /** 标签不在点左右紧邻位:渲染层补 leader line 连回原点。 */
  leader: boolean;
}

/** 标签框高度(基线上方 10px、下方 2px,对应 11px 字号)。 */
const LABEL_ASCENT = 10;
const LABEL_DESCENT = 2;
/** 数据点视为边长 2×DOT_R 的方形障碍(点半径 4.5 + 命中余量)。 */
const DOT_R = 6;
/** 紧邻位与点的水平间距;候选环按它逐环外扩。 */
const NEAR = 10;
const RINGS = [NEAR, NEAR + 12, NEAR + 26];

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function labelBoxAt(x: number, y: number, anchor: PlacedPointLabel["anchor"], width: number): Box {
  const x0 = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
  return { x0, y0: y - LABEL_ASCENT, x1: x0 + width, y1: y + LABEL_DESCENT };
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

function outOfBoundsArea(box: Box, bounds: LabelBounds): number {
  const total = (box.x1 - box.x0) * (box.y1 - box.y0);
  const w = Math.min(box.x1, bounds.x1) - Math.max(box.x0, bounds.x0);
  const h = Math.min(box.y1, bounds.y1) - Math.max(box.y0, bounds.y0);
  const inside = w > 0 && h > 0 ? w * h : 0;
  return total - inside;
}

/** 一个点在距离 d 的候选环:左右紧邻、四个斜角、正上正下。顺序即同代价时的偏好序。 */
function ringCandidates(p: PointLabelInput, d: number): Omit<PlacedPointLabel, "leader">[] {
  const diag = d * 0.75;
  return [
    { x: p.cx + d, y: p.cy + 4, anchor: "start" },
    { x: p.cx - d, y: p.cy + 4, anchor: "end" },
    { x: p.cx + diag, y: p.cy - diag - 2, anchor: "start" },
    { x: p.cx - diag, y: p.cy - diag - 2, anchor: "end" },
    { x: p.cx, y: p.cy - d - LABEL_DESCENT - 2, anchor: "middle" },
    { x: p.cx + diag, y: p.cy + diag + LABEL_ASCENT, anchor: "start" },
    { x: p.cx - diag, y: p.cy + diag + LABEL_ASCENT, anchor: "end" },
    { x: p.cx, y: p.cy + d + LABEL_ASCENT + 2, anchor: "middle" },
  ];
}

/**
 * 散点直接标签的候选位择优布局(docs/feature/reports/library.md「MetricScatter」):
 * 每个标签在点四周由近及远的候选环上打分——与已放置标签的重叠、与任何数据点的重叠、
 * 越出画布的面积、离点距离逐项累加,取代价最小的候选。存在无冲突候选时标签必不遮点、
 * 不叠标签、不越界;全候选冲突时取重叠最小者,绝不丢标签。重合点簇因此向不同方向散开,
 * 而不是单向堆叠压到下方的数据点上。
 */
export function placePointLabels(points: PointLabelInput[], bounds: LabelBounds): PlacedPointLabel[] {
  const dots: Box[] = points.map((p) => ({ x0: p.cx - DOT_R, y0: p.cy - DOT_R, x1: p.cx + DOT_R, y1: p.cy + DOT_R }));
  const placedBoxes: Box[] = [];
  const result: PlacedPointLabel[] = new Array(points.length);
  // 由上到下、由左到右逐个放置,布局确定可复现
  const order = [...points.keys()].sort((a, b) => points[a].cy - points[b].cy || points[a].cx - points[b].cx);

  for (const i of order) {
    const p = points[i];
    let best: { candidate: Omit<PlacedPointLabel, "leader">; box: Box; cost: number; leader: boolean } | null = null;
    for (let ring = 0; ring < RINGS.length; ring++) {
      const candidates = ringCandidates(p, RINGS[ring]);
      for (let c = 0; c < candidates.length; c++) {
        const candidate = candidates[c];
        const box = labelBoxAt(candidate.x, candidate.y, candidate.anchor, p.width);
        let cost = 0;
        for (const placed of placedBoxes) cost += overlapArea(box, placed) * 4;
        for (const dot of dots) cost += overlapArea(box, dot) * 3;
        cost += outOfBoundsArea(box, bounds) * 6;
        cost += ring * 8 + c * 0.5; // 近环、偏好序靠前者优先,只作同冲突程度下的排序
        if (best === null || cost < best.cost) {
          best = { candidate, box, cost, leader: !(ring === 0 && c <= 1) };
        }
      }
    }
    placedBoxes.push(best!.box);
    result[i] = { ...best!.candidate, leader: best!.leader };
  }
  return result;
}
