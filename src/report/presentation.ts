import { shortestUniqueLabels as labels } from "./model/format.ts";
import {
  seriesColorVar,
  seriesFill,
  seriesMarker,
  seriesStrokeDasharray,
} from "./assets/series-encoding.tsx";

export type DimensionEncoding =
  | { readonly kind: "label" }
  | { readonly kind: "color" }
  | { readonly kind: "series"; readonly mark: "line" | "scatter" | "bar" | "area" };

export interface DimensionDeclaration<E extends DimensionEncoding = DimensionEncoding> {
  readonly dimension: string;
  readonly encoding: E;
  /** 顺序与 renderer 使用的数据项顺序一致；允许重复值。 */
  readonly values: readonly string[];
}

export type DimensionDeclarations = Readonly<Record<string, DimensionDeclaration>>;

/** 外层键是维度 name，内层键是维度值显示键，值是 [1, 24] 的 seriesSlot。 */
export type DimensionPins = Readonly<Record<string, Readonly<Record<string, number>>>>;

export const VISUAL_SLOT_COUNT = 24;

export type SeriesVariant = 1 | 2 | 3 | 4;

/**
 * 槽 1..24 → (色板下标 1..6, 形状变体 1..4)。
 * 与 components/README「视觉编码容量」槽序表一致:1–6 第一变体、7–12 第二变体,依此类推。
 * `colorIndex = (slot-1) % 6 + 1`,`variant = floor((slot-1)/6) + 1`。
 */
export function seriesChannelsOf(slot: number): { colorIndex: number; variant: SeriesVariant } {
  if (!Number.isInteger(slot) || slot < 1 || slot > VISUAL_SLOT_COUNT) {
    throw new Error(`seriesSlot must be an integer in [1, ${VISUAL_SLOT_COUNT}], got ${slot}.`);
  }
  const zero = slot - 1;
  return {
    colorIndex: (zero % 6) + 1,
    variant: (Math.floor(zero / 6) + 1) as SeriesVariant,
  };
}

// ─── docs/feature/reports/README.md 的呈现家族 ───

export interface PresentationIdentity {
  /** 完整维度值，作为排序、筛选、React key 与证据身份。 */
  readonly value: string;
  /** 当前页完整 label keyset 内生成的显示名。 */
  readonly label: string;
}

export interface LabelPresentation extends PresentationIdentity {
  readonly kind: "label";
}

export interface ColorPresentation extends PresentationIdentity {
  readonly kind: "color";
  /** `var(--niceeval-color-series-N)`。 */
  readonly color: string;
}

export interface LineSeriesPresentation extends PresentationIdentity {
  readonly kind: "series";
  readonly mark: "line";
  readonly stroke: string;
  readonly strokeDasharray: string;
  readonly marker: {
    readonly path: string;
    readonly viewBox: string;
    readonly fill: string;
    readonly stroke: string;
  };
}

export interface ScatterSeriesPresentation extends PresentationIdentity {
  readonly kind: "series";
  readonly mark: "scatter";
  readonly marker: LineSeriesPresentation["marker"];
}

export interface FillSeriesPresentation extends PresentationIdentity {
  readonly kind: "series";
  readonly mark: "bar" | "area";
  /** 颜色，或可直接使用的 `url(#pattern-id)`。 */
  readonly fill: string;
  readonly stroke: string;
  readonly strokeDasharray: string;
}

export type DimensionPresentation =
  | LabelPresentation
  | ColorPresentation
  | LineSeriesPresentation
  | ScatterSeriesPresentation
  | FillSeriesPresentation;

export type PresentationFor<E extends DimensionEncoding> = E extends { kind: "label" }
  ? LabelPresentation
  : E extends { kind: "color" }
    ? ColorPresentation
    : LineSeriesPresentation | ScatterSeriesPresentation | FillSeriesPresentation;

/**
 * 句柄上的呈现面。`at(i)` 返回可直接交给 SVG/CSS 的值;text 面恒为 label 支。
 * `labels` 是本维度整页 label keyset 的最短唯一后缀表,便于探针与调试。
 */
export interface PresentedDimension {
  readonly length: number;
  readonly labels: ReadonlyMap<string, string>;
  at(index: number): DimensionPresentation;
}

export class UndeclaredDimensionValueError extends Error {
  readonly handle: string;
  readonly index?: number;
  constructor(message: string, handle: string, index?: number) {
    super(message);
    this.name = "UndeclaredDimensionValueError";
    this.handle = handle;
    this.index = index;
  }
}

/**
 * 供独立 React 页面使用的纯呈现工具。标签按完整域去重；视觉槽位仅为声明了
 * color/series 的值分配，超过 24 个身份明确失败而不复用。
 */
export function presentDimension(declaration: DimensionDeclaration): PresentedDimension {
  const plan = allocatePageDimensions([{ handle: "_", declaration }], {});
  const presented = plan.byHandle.get("_");
  if (!presented) throw new Error(`presentDimension failed to allocate "${declaration.dimension}".`);
  return presented;
}

export const shortestUniqueLabels = labels;

export interface PageDimensionHandle {
  readonly handle: string;
  readonly declaration: DimensionDeclaration;
}

export interface PageDimensionPlan {
  /** 句柄 → 呈现面（含按 index 查询）。 */
  readonly byHandle: ReadonlyMap<string, PresentedDimension>;
  /** 维度 name → 值 → seriesSlot（仅 visual keyset）。 */
  readonly slotsByDimension: ReadonlyMap<string, ReadonlyMap<string, number>>;
  dimension(handle: string): PresentedDimension;
}

function presentChannels(
  value: string,
  label: string,
  seriesSlot: number,
  encoding: DimensionEncoding,
): DimensionPresentation {
  const { colorIndex, variant } = seriesChannelsOf(seriesSlot);
  if (encoding.kind === "color") {
    return { kind: "color", value, label, color: seriesColorVar(colorIndex) };
  }
  if (encoding.kind !== "series") {
    return { kind: "label", value, label };
  }
  const stroke = seriesColorVar(colorIndex);
  const strokeDasharray = seriesStrokeDasharray(variant);
  const marker = seriesMarker(colorIndex, variant);
  switch (encoding.mark) {
    case "line":
      return { kind: "series", mark: "line", value, label, stroke, strokeDasharray, marker };
    case "scatter":
      return { kind: "series", mark: "scatter", value, label, marker };
    case "bar":
    case "area":
      return {
        kind: "series",
        mark: encoding.mark,
        value,
        label,
        fill: seriesFill(colorIndex, variant),
        stroke,
        strokeDasharray,
      };
  }
}

/**
 * 页级呈现分配：收集整页 dimensions() 声明，产出 label / visual 两套 keyset 上的映射。
 * pins 原样占位；未钉键以稳定散列为起点、撞槽按显示键字典序线性探测。
 */
export function allocatePageDimensions(
  handles: readonly PageDimensionHandle[],
  pins: DimensionPins = {},
  options: { readonly face: "text" | "web" } = { face: "web" },
): PageDimensionPlan {
  const labelSets = new Map<string, Set<string>>();
  const visualSets = new Map<string, Set<string>>();
  for (const { declaration } of handles) {
    if (!declaration.dimension || typeof declaration.dimension !== "string") {
      throw new Error('dimensions() returned a declaration with an empty dimension name.');
    }
    let labelSet = labelSets.get(declaration.dimension);
    if (!labelSet) labelSets.set(declaration.dimension, (labelSet = new Set()));
    for (const value of declaration.values) labelSet.add(value);
    if (declaration.encoding.kind === "color" || declaration.encoding.kind === "series") {
      let visualSet = visualSets.get(declaration.dimension);
      if (!visualSet) visualSets.set(declaration.dimension, (visualSet = new Set()));
      for (const value of declaration.values) visualSet.add(value);
    }
  }

  const slotsByDimension = new Map<string, Map<string, number>>();
  if (options.face === "web") {
    for (const [dimension, values] of visualSets) {
      const unique = [...values];
      if (unique.length > VISUAL_SLOT_COUNT) {
        throw new Error(
          `dimension "${dimension}" has ${unique.length} series, but the built-in encoding supports ${VISUAL_SLOT_COUNT}\n` +
            "fix: filter the series, or split them into facets/pages",
        );
      }
      slotsByDimension.set(dimension, assignSlots(dimension, unique, pins[dimension] ?? {}));
    }
  }

  const labelsByDimension = new Map<string, ReadonlyMap<string, string>>();
  for (const [dimension, values] of labelSets) {
    labelsByDimension.set(dimension, labels([...values]));
  }

  const byHandle = new Map<string, PresentedDimension>();
  for (const { handle, declaration } of handles) {
    const dimLabels = labelsByDimension.get(declaration.dimension) ?? new Map();
    const slots = slotsByDimension.get(declaration.dimension);
    const values = declaration.values;
    const encoding = declaration.encoding;
    byHandle.set(handle, {
      length: values.length,
      labels: dimLabels,
      at(index: number): DimensionPresentation {
        const value = values[index];
        if (value === undefined) {
          throw new UndeclaredDimensionValueError(
            `dimension handle "${handle}" has no value at index ${index} (declared length ${values.length}).`,
            handle,
            index,
          );
        }
        const label = dimLabels.get(value) ?? value;
        // text 面恒返回 label 支:不上 ANSI 色,拿不到颜色、线型或 pattern。
        if (options.face === "text" || encoding.kind === "label") {
          return { kind: "label", value, label };
        }
        const seriesSlot = slots?.get(value);
        if (seriesSlot === undefined) {
          throw new UndeclaredDimensionValueError(
            `dimension handle "${handle}" value ${JSON.stringify(value)} has no seriesSlot on this page.`,
            handle,
            index,
          );
        }
        return presentChannels(value, label, seriesSlot, encoding);
      },
    });
  }

  return {
    byHandle,
    slotsByDimension,
    dimension(handle: string): PresentedDimension {
      const presented = byHandle.get(handle);
      if (!presented) {
        throw new UndeclaredDimensionValueError(
          `dimension handle "${handle}" was not declared by this component's dimensions().`,
          handle,
        );
      }
      return presented;
    },
  };
}

function assignSlots(
  dimension: string,
  values: readonly string[],
  pins: Readonly<Record<string, number>>,
): Map<string, number> {
  const used = new Set<number>();
  const out = new Map<string, number>();
  // 钉住的键原样占位；多个值钉同一槽合法，不触发探测。本页未出现的钉键不占槽。
  for (const value of values) {
    const pinned = pins[value];
    if (pinned === undefined) continue;
    if (!Number.isInteger(pinned) || pinned < 1 || pinned > VISUAL_SLOT_COUNT) {
      throw new Error(
        `dimensionPins.${dimension}.${value} must be an integer in [1, ${VISUAL_SLOT_COUNT}], got ${JSON.stringify(pinned)}.`,
      );
    }
    out.set(value, pinned);
    used.add(pinned);
  }
  // 未钉键：稳定散列为起点，撞槽按显示键字典序线性探测。
  const unpinned = values.filter((value) => !out.has(value)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const value of unpinned) {
    let slot = (stableHash(`${dimension}\0${value}`) % VISUAL_SLOT_COUNT) + 1;
    let guard = 0;
    while (used.has(slot) && guard < VISUAL_SLOT_COUNT) {
      slot = (slot % VISUAL_SLOT_COUNT) + 1;
      guard += 1;
    }
    if (used.has(slot)) {
      throw new Error(
        `dimension "${dimension}" has ${values.length} series, but the built-in encoding supports ${VISUAL_SLOT_COUNT}\n` +
          "fix: filter the series, or split them into facets/pages",
      );
    }
    out.set(value, slot);
    used.add(slot);
  }
  return out;
}

/** FNV-1a → [0, 23]；与 colors.ts 同源算法，量程扩到 24 槽。 */
function stableHash(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash % VISUAL_SLOT_COUNT;
}

/** defineReport 装载期校验 dimensionPins 形状。 */
export function assertDimensionPins(pins: unknown): asserts pins is DimensionPins {
  if (pins === undefined) return;
  if (!pins || typeof pins !== "object" || Array.isArray(pins)) {
    throw new Error("dimensionPins must be an object of { [dimension]: { [value]: seriesSlot } }.");
  }
  for (const [dimension, values] of Object.entries(pins as Record<string, unknown>)) {
    if (!dimension) throw new Error('dimensionPins."" is not a valid dimension name.');
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      throw new Error(`dimensionPins.${dimension} must be an object of value → seriesSlot.`);
    }
    for (const [value, slot] of Object.entries(values as Record<string, unknown>)) {
      if (!value) throw new Error(`dimensionPins.${dimension}."" is not a valid value key.`);
      if (!Number.isInteger(slot) || (slot as number) < 1 || (slot as number) > VISUAL_SLOT_COUNT) {
        throw new Error(
          `dimensionPins.${dimension}.${value} must be an integer in [1, ${VISUAL_SLOT_COUNT}], got ${JSON.stringify(slot)}.`,
        );
      }
    }
  }
}
