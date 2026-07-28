import { shortestUniqueLabels as labels } from "./model/format.ts";

export type DimensionEncoding =
  | { readonly kind: "label" }
  | { readonly kind: "color" }
  | { readonly kind: "series"; readonly mark: "line" | "scatter" | "bar" | "area" };

export interface DimensionDeclaration<E extends DimensionEncoding = DimensionEncoding> {
  readonly dimension: string;
  readonly encoding: E;
  readonly values: readonly string[];
}

export interface PresentedDimension {
  readonly labels: ReadonlyMap<string, string>;
  at(index: number): { value: string; label: string; seriesSlot?: number };
}

/**
 * 供独立 React 页面使用的纯呈现工具。标签按完整域去重；视觉槽位仅为声明了
 * color/series 的值分配，超过 24 个身份明确失败而不复用。
 */
export function presentDimension(declaration: DimensionDeclaration): PresentedDimension {
  const values = [...declaration.values];
  const unique = [...new Set(values)];
  if (declaration.encoding.kind !== "label" && unique.length > 24) {
    throw new Error(
      `dimension "${declaration.dimension}" has ${unique.length} series, but the built-in encoding supports 24\n` +
        "fix: filter the series, or split them into facets/pages",
    );
  }
  const labelsByValue = labels(unique);
  const slots = new Map(unique.map((value, index) => [value, index + 1]));
  return {
    labels: labelsByValue,
    at(index) {
      const value = values[index];
      if (value === undefined) throw new Error(`dimension "${declaration.dimension}" has no value at index ${index}.`);
      return {
        value,
        label: labelsByValue.get(value) ?? value,
        ...(declaration.encoding.kind === "label" ? {} : { seriesSlot: slots.get(value)! }),
      };
    },
  };
}

export const shortestUniqueLabels = labels;
