// 跨块配色一致(docs/feature/reports/architecture.md「静态网页」):
// 系列/维度键 → 固定调色板下标,用稳定散列而不是「按出现顺序分配」。
// 这样同一个 agent 在 scatter 的线、DeltaTable 的行、matrix 的列头永远同色,
// 不需要 Provider、不需要手工配置,甚至不需要两个组件见过同一份数据。
//
// 色板与 view 统一:六色 CVD 校验色板(src/view/styles.css 的 --series-1..6),
// 顺序不要重排。深浅两套值都住在 styles.css 的 --nre-c0..c5(light-dark()),
// 「CSS 与 colors.ts 逐个对应」契约:NRE_PALETTE 是浅色主题那套值的拷贝,
// 渲染面优先挂类名(nre-cN 上文字色、nre-series-cN 上图形系列色)由 CSS 上色,
// 深色主题才能跟随;colorHexForKey 只留给「不经 CSS」的消费方。改色时两边一起改。

/** 固定调色板(浅色主题值);下标即 nre-cN / nre-series-cN 的 N,与 styles.css 的 --nre-cN 逐个对应。 */
export const NRE_PALETTE = [
  "#2a78d6", // c0 蓝(dark: #3987e5)
  "#1baf7a", // c1 绿(dark: #199e70)
  "#eda100", // c2 琥珀(dark: #c98500)
  "#008300", // c3 深绿(dark: #008300)
  "#e34948", // c4 红(dark: #e66767)
  "#eb6834", // c5 橙(dark: #d95926)
] as const;

export const NRE_PALETTE_SIZE = NRE_PALETTE.length;

/** FNV-1a 32 位散列:输入相同永远得到相同下标,与运行顺序无关。 */
export function colorIndexForKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    // FNV prime 乘法,拆成移位加法保持 32 位整数运算
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash % NRE_PALETTE_SIZE;
}

/** 键对应的稳定 class 名("nre-c3"),配 styles.css 的 .nre-cN 上文字色。 */
export function colorClassForKey(key: string): string {
  return `nre-c${colorIndexForKey(key)}`;
}

/**
 * 键对应的系列 class 名("nre-series-c3"):挂在 SVG 图形元素(线/点/柱/系列名)上,
 * styles.css 用它设置 --nre-series,fill/stroke 走 var —— 深色主题下图表随之切换。
 */
export function seriesClassForKey(key: string): string {
  return `nre-series-c${colorIndexForKey(key)}`;
}

/** 键对应的十六进制颜色(浅色主题值);渲染面优先类名,这里只留给不经 CSS 的消费方。 */
export function colorHexForKey(key: string): string {
  return NRE_PALETTE[colorIndexForKey(key)];
}
