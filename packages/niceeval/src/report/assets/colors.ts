// 跨块配色一致(docs/feature/reports/architecture.md「静态网页」):
// 系列/维度键 → 固定调色板下标,用稳定散列而不是「按出现顺序分配」。
// 这样同一个 agent 在 scatter 的线、比较表的行、matrix 的列头永远同色,
// 不需要 Provider、不需要手工配置,甚至不需要两个组件见过同一份数据。
//
// 渲染面优先挂类名(niceeval-cN 上文字色、niceeval-series-cN 上图形系列色)由 CSS 上色:
// 类名只携带下标,颜色值由生效主题的 --niceeval-color-series-N 决定,换主题图表跟着换。
// 十六进制值只留给「不经 CSS」的消费方(colorHexForKey),取默认主题 basalt 的系列色——
// 单源在 src/report/theme.ts,这里不复制一份色板。

import { basalt } from "../theme.ts";

/** 默认主题 basalt 的六色 CVD 色板;下标即 niceeval-cN / niceeval-series-cN 的 N。 */
export const SERIES_PALETTE = (basalt.series ?? []).map((color) =>
  typeof color === "string" ? color : color.dark,
) as readonly string[];

export const SERIES_PALETTE_SIZE = SERIES_PALETTE.length;

/** FNV-1a 32 位散列:输入相同永远得到相同下标,与运行顺序无关。 */
export function colorIndexForKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    // FNV prime 乘法,拆成移位加法保持 32 位整数运算
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash % SERIES_PALETTE_SIZE;
}

/**
 * 同一张图内 series 键集合的配色:每个键仍以稳定散列为起点(无冲突时与跨图配色一致),
 * 图内撞色时按传入顺序(图例顺序)线性探测下一个空色格——跨图稳定让位给图内可辨;
 * 键数超过色板后无空格可探,回落散列格(复用不可避免)。返回键 → 色板下标。
 * 契约见 docs/feature/reports/library.md「系列色:分配单位是页」;
 * 修法台账见 memory/scatter-series-color-collision.md。
 */
export function colorIndicesForKeys(keys: readonly string[]): Map<string, number> {
  const used = new Set<number>();
  const out = new Map<string, number>();
  for (const key of keys) {
    if (out.has(key)) continue;
    let idx = colorIndexForKey(key);
    if (used.size < SERIES_PALETTE_SIZE) {
      while (used.has(idx)) idx = (idx + 1) % SERIES_PALETTE_SIZE;
    }
    used.add(idx);
    out.set(key, idx);
  }
  return out;
}

/** 键对应的稳定 class 名("niceeval-c3"),配 styles.css 的 .niceeval-cN 上文字色。 */
export function colorClassForKey(key: string): string {
  return `niceeval-c${colorIndexForKey(key)}`;
}

/**
 * 键对应的系列 class 名("niceeval-series-c3"):挂在 SVG 图形元素(线/点/柱/系列名)上,
 * styles.css 用它设置 --series,fill/stroke 走 var —— 换主题时图表随之切换。
 */
export function seriesClassForKey(key: string): string {
  return `niceeval-series-c${colorIndexForKey(key)}`;
}

/** 键对应的十六进制颜色(basalt 系列色);渲染面优先类名,这里只留给不经 CSS 的消费方。 */
export function colorHexForKey(key: string): string {
  return SERIES_PALETTE[colorIndexForKey(key)]!;
}
