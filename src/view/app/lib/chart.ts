// 通用图表数值工具:round-number 刻度生成,无第三方依赖(遵循 view/ 不引图表库的现状)。

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

/** 六色分类色板之外的第 7+ 个系列一律回退到中性色,避免同色误导身份(见 dataviz 分类色板规则)。 */
export function seriesColor(index: number): string {
  return index < 6 ? `var(--series-${index + 1})` : "var(--muted)";
}

export interface LabelInput {
  cx: number;
  cy: number;
  width: number;
  /** true = 文字锚在点左侧(text-anchor: end),false = 锚在右侧(text-anchor: start)。 */
  anchorLeft: boolean;
}

/**
 * 贪心地把互相重叠的直接标签往下推开(按 y 排序、逐个查重叠再下移),点本身位置不变。
 * 散点常见同分不同价的聚簇,这一步避免标签叠成一团糊字。
 */
export function layoutLabelOffsets(items: LabelInput[], lineHeight = 14, padX = 4): number[] {
  const offsets = new Array(items.length).fill(0);
  const order = [...items.keys()].sort((a, b) => items[a].cy - items[b].cy || items[a].cx - items[b].cx);
  const placed: { x0: number; x1: number; y: number }[] = [];
  for (const i of order) {
    const it = items[i];
    const x0 = it.anchorLeft ? it.cx - it.width : it.cx;
    const x1 = it.anchorLeft ? it.cx : it.cx + it.width;
    let y = it.cy;
    let guard = 0;
    while (guard < 40 && placed.some((p) => x0 < p.x1 + padX && x1 > p.x0 - padX && Math.abs(y - p.y) < lineHeight)) {
      y += lineHeight;
      guard++;
    }
    placed.push({ x0, x1, y });
    offsets[i] = y - it.cy;
  }
  return offsets;
}
