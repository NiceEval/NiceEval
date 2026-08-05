// 24 视觉身份 = 六色 × 四变体的可直接使用 SVG/CSS 值。
// 契约:docs/feature/reports/library/presentation.md「实验颜色与维度呈现」、
// docs/feature/reports/components/README.md「视觉编码容量（24 个身份）」。
// pattern id 全局唯一、颜色走主题令牌 --niceeval-color-series-N,换 basalt/chalk 自动换色。

import type { ReactNode } from "react";
import type { SeriesVariant } from "../presentation.ts";

/** 槽位色板下标 1..6 → CSS 变量,原样交给 fill / stroke / color。 */
export function seriesColorVar(colorIndex: number): string {
  if (!Number.isInteger(colorIndex) || colorIndex < 1 || colorIndex > 6) {
    throw new Error(`colorIndex must be an integer in [1, 6], got ${colorIndex}.`);
  }
  return `var(--niceeval-color-series-${colorIndex})`;
}

/** SVG pattern id:niceeval-series-pat-v{2|3|4}-c{1..6}。variant 1 是实心,无 pattern。 */
export function seriesPatternId(colorIndex: number, variant: SeriesVariant): string {
  if (variant === 1) {
    throw new Error("variant 1 is solid fill; it has no pattern id.");
  }
  return `niceeval-series-pat-v${variant}-c${colorIndex}`;
}

export function seriesFill(colorIndex: number, variant: SeriesVariant): string {
  if (variant === 1) return seriesColorVar(colorIndex);
  return `url(#${seriesPatternId(colorIndex, variant)})`;
}

/** 线型变体 → strokeDasharray;variant 1 为空串(实线)。 */
export function seriesStrokeDasharray(variant: SeriesVariant): string {
  switch (variant) {
    case 1:
      return "";
    case 2:
      return "6 4";
    case 3:
      return "2 3";
    case 4:
      return "8 3 2 3";
  }
}

export interface SeriesMarkerShape {
  readonly path: string;
  readonly viewBox: string;
}

/** 四种 marker 形状(viewBox 0 0 12 12),变体按 docs 槽序表 1–4。 */
export function seriesMarkerShape(variant: SeriesVariant): SeriesMarkerShape {
  switch (variant) {
    case 1:
      // 圆
      return { path: "M6 1.5a4.5 4.5 0 1 0 0.01 0z", viewBox: "0 0 12 12" };
    case 2:
      // 方
      return { path: "M2.5 2.5h7v7h-7z", viewBox: "0 0 12 12" };
    case 3:
      // 菱
      return { path: "M6 1.5 10.5 6 6 10.5 1.5 6z", viewBox: "0 0 12 12" };
    case 4:
      // 三角
      return { path: "M6 1.5 10.5 10.5 1.5 10.5z", viewBox: "0 0 12 12" };
  }
}

export function seriesMarker(colorIndex: number, variant: SeriesVariant): {
  readonly path: string;
  readonly viewBox: string;
  readonly fill: string;
  readonly stroke: string;
} {
  const shape = seriesMarkerShape(variant);
  const color = seriesColorVar(colorIndex);
  return {
    path: shape.path,
    viewBox: shape.viewBox,
    fill: color,
    stroke: color,
  };
}

/**
 * 从 presentation.fill 反推 HTML 柱需要的系列 class。
 * SVG 用 url(#pattern)/var();HTML 柱不能引用 SVG pattern,改挂 series-cN + fill-vN 类,
 * 由 styles.css 用 repeating-linear-gradient 画等效图案,颜色仍走 --series 令牌。
 */
export function seriesClassesFromFill(fill: string): string {
  const pattern = /^url\(#niceeval-series-pat-v([2-4])-c([1-6])\)$/.exec(fill);
  if (pattern) {
    const variant = pattern[1]!;
    const colorIndex = Number(pattern[2]);
    return `niceeval-series-c${colorIndex - 1} niceeval-series-fill-v${variant}`;
  }
  const solid = /^var\(--niceeval-color-series-([1-6])\)$/.exec(fill);
  if (solid) {
    return `niceeval-series-c${Number(solid[1]) - 1}`;
  }
  return "niceeval-series-none";
}

/** 从 color 呈现或 series 的 stroke/fill 反推 series-cN 类(图例色点回落)。 */
export function seriesClassFromColorVar(color: string): string {
  const solid = /^var\(--niceeval-color-series-([1-6])\)$/.exec(color);
  if (solid) return `niceeval-series-c${Number(solid[1]) - 1}`;
  return "niceeval-series-none";
}

/**
 * 页内注入一次的 SVG pattern defs。
 * 18 个 pattern(3 非实心变体 × 6 色);id 与 seriesFill() 产出的 url(#…) 对齐。
 * 子元素直接写 var(--niceeval-color-series-N),不走 currentColor
 * (SVG pattern 内部 currentColor 取自 pattern 自身,引用者传不进来)。
 */
export function SeriesPatternDefs(): ReactNode {
  const patterns: ReactNode[] = [];
  for (let colorIndex = 1; colorIndex <= 6; colorIndex++) {
    const color = seriesColorVar(colorIndex);
    // v2:对角斜线
    patterns.push(
      <pattern
        key={`v2-c${colorIndex}`}
        id={seriesPatternId(colorIndex, 2)}
        patternUnits="userSpaceOnUse"
        width="6"
        height="6"
      >
        <rect width="6" height="6" fill={color} fillOpacity={0.22} />
        <path
          d="M-1 1l2-2M0 6l6-6M5 7l2-2"
          stroke={color}
          strokeWidth={1.4}
          fill="none"
        />
      </pattern>,
    );
    // v3:水平条纹
    patterns.push(
      <pattern
        key={`v3-c${colorIndex}`}
        id={seriesPatternId(colorIndex, 3)}
        patternUnits="userSpaceOnUse"
        width="6"
        height="6"
      >
        <rect width="6" height="6" fill={color} fillOpacity={0.18} />
        <path d="M0 1.5h6M0 4.5h6" stroke={color} strokeWidth={1.5} fill="none" />
      </pattern>,
    );
    // v4:点阵
    patterns.push(
      <pattern
        key={`v4-c${colorIndex}`}
        id={seriesPatternId(colorIndex, 4)}
        patternUnits="userSpaceOnUse"
        width="6"
        height="6"
      >
        <rect width="6" height="6" fill={color} fillOpacity={0.16} />
        <circle cx="2" cy="2" r="1.15" fill={color} />
        <circle cx="5" cy="5" r="1.15" fill={color} />
      </pattern>,
    );
  }
  return (
    <svg
      className="niceeval-series-defs"
      width={0}
      height={0}
      aria-hidden="true"
      focusable="false"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
    >
      <defs>{patterns}</defs>
    </svg>
  );
}
