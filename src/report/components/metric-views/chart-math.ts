// 通用图表数值工具:图轴值域推定、round-number 刻度生成与点标签布局,零依赖纯函数。

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

/** 指标的自然边界(Metric.bounds / MetricColumn.bounds);两端各自可选。 */
export interface AxisBounds {
  min?: number;
  max?: number;
}

/**
 * 图轴值域推定(docs/feature/reports/library/metric-views.md「图轴值域」):数据极值向两端
 * 各扩数据跨度的 5%,数据极值点因此不落在绘图框线上。数据跨度为零(单点,或全部点同值)时,
 * 边距改取该值绝对值的 5%;值恰为 0 时取 1(否则唯一的点仍会贴框)。声明了 bounds 的一端,
 * 边距截到边界为止——贴边数据点如实落在框线上(如通过率 100%),那是指标的自然边界,不是
 * 裁剪。MetricScatter 的两轴与 MetricLine 的两轴共用同一个函数;MetricLine 的 x 轴
 * (NumericAxis)没有 bounds,调用时不传第二参,只扩边距不钳制。web SVG 与 text 字符坐标图
 * 消费同一份返回值,渲染层不重算。
 */
export function paddedAxisDomain(values: readonly number[], bounds?: AxisBounds): [number, number] {
  const dataLo = Math.min(...values);
  const dataHi = Math.max(...values);
  const span = dataHi - dataLo;
  const margin = span > 0 ? span * 0.05 : dataLo === 0 ? 1 : Math.abs(dataLo) * 0.05;
  let lo = dataLo - margin;
  let hi = dataHi + margin;
  if (bounds?.min !== undefined) lo = Math.max(lo, bounds.min);
  if (bounds?.max !== undefined) hi = Math.min(hi, bounds.max);
  return [lo, hi];
}

/**
 * `[lo, hi]` 域内的整齐(Heckbert nice-numbers)刻度。与经典算法的差别:经典算法向外扩张
 * `[min, max]` 到下一个整齐边界再取刻度;这里 `[lo, hi]` 已经是呼吸边距 / bounds 钳制后的
 * 值域本身,刻度只在其内部取值,不再向外扩张——否则会在值域之外画出不存在的假刻度。
 */
export function ticksInDomain(lo: number, hi: number, count = 5): number[] {
  if (lo >= hi) return [lo];
  const step = niceNumber((hi - lo) / Math.max(1, count - 1), true);
  const eps = step * 1e-9;
  const ticks: number[] = [];
  for (let v = Math.ceil((lo - eps) / step) * step; v <= hi + eps; v += step) {
    const rounded = Number(v.toFixed(10));
    if (rounded >= lo - eps && rounded <= hi + eps) ticks.push(rounded);
  }
  return ticks.length > 0 ? ticks : [lo, hi];
}

export interface AxisScale {
  /** 值域内的整齐刻度(ticksInDomain 的产物)。 */
  ticks: number[];
  /** 值 → 像素坐标的线性映射。 */
  scale(value: number): number;
}

/**
 * 一根轴的完整推定:先用 `paddedAxisDomain` 定值域(呼吸边距 + bounds 钳制),再用
 * `ticksInDomain` 在域内取整齐刻度,最后按 `[pixelLo, pixelHi]` 做线性映射。`invert` 只影响
 * 最后这一步的映射方向(`better: "lower"` 的轴反向渲染)——值域先按呼吸边距 / bounds 推定,
 * 再决定要不要反向,反向不改变值域本身或钳制结果。MetricScatter 与 MetricLine 的两轴共用
 * 这一个函数(docs/feature/reports/library/metric-views.md「图轴值域」)。
 */
export function axisScale(
  values: readonly number[],
  bounds: AxisBounds | undefined,
  pixelLo: number,
  pixelHi: number,
  invert: boolean,
): AxisScale {
  const [lo, hi] = paddedAxisDomain(values, bounds);
  const ticks = ticksInDomain(lo, hi, 5);
  return {
    ticks,
    scale(v: number): number {
      let t = (v - lo) / (hi - lo || 1);
      if (invert) t = 1 - t;
      return pixelLo + t * (pixelHi - pixelLo);
    },
  };
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
