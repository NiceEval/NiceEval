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

export interface AxisBounds {
  min?: number;
  max?: number;
}

export function paddedAxisDomain(values: readonly number[], bounds?: AxisBounds): [number, number] {
  const dataLo = Math.min(...values);
  const dataHi = Math.max(...values);
  const span = dataHi - dataLo;
  const margin = span > 0 ? span * 0.2 : dataLo === 0 ? 1 : Math.abs(dataLo) * 0.2;
  let lo = dataLo - margin;
  let hi = dataHi + margin;
  if (bounds?.min !== undefined) lo = Math.max(lo, bounds.min);
  if (bounds?.max !== undefined) hi = Math.min(hi, bounds.max);

  const reference =
    bounds?.min !== undefined && bounds?.max !== undefined
      ? bounds.max - bounds.min
      : bounds?.min !== undefined
        ? dataHi - bounds.min
        : bounds?.max !== undefined
          ? bounds.max - dataLo
          : undefined;
  if (reference !== undefined) {
    const deficit = reference / 3 - (hi - lo);
    if (deficit > 0) {
      lo -= deficit / 2;
      hi += deficit / 2;
      if (bounds?.min !== undefined && lo < bounds.min) {
        hi += bounds.min - lo;
        lo = bounds.min;
      }
      if (bounds?.max !== undefined && hi > bounds.max) {
        lo = Math.max(lo - (hi - bounds.max), bounds?.min ?? -Infinity);
        hi = bounds.max;
      }
    }
  }
  return [lo, hi];
}

export function tickStepOf(ticks: readonly number[]): number {
  return ticks.length > 1 ? ticks[1]! - ticks[0]! : Number.NaN;
}

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
