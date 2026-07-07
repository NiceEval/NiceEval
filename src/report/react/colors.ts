// 跨块配色一致(docs/reports.md 四条跨组件契约之二):
// 系列/维度键 → 固定调色板下标,用稳定散列而不是「按出现顺序分配」。
// 这样同一个 agent 在 scatter 的线、DeltaTable 的行、matrix 的列头永远同色,
// 不需要 Provider、不需要手工配置,甚至不需要两个组件见过同一份数据。
// 调色板的十六进制值以这里为准:SVG(scatter 的线和点)直接内联 hex,
// 保证漏加载 styles.css 时图形仍然分得清系列;styles.css 里的 --nre-c0..c7
// 是同一组值的拷贝(供 .nre-cN 文本类用),改色时两边一起改。

/** 固定调色板;下标即 nre-cN 的 N,与 styles.css 的 --nre-cN 逐个对应。 */
export const NRE_PALETTE = [
  "#2563eb", // c0 蓝
  "#db2777", // c1 玫红
  "#059669", // c2 绿
  "#d97706", // c3 橙
  "#7c3aed", // c4 紫
  "#0891b2", // c5 青
  "#dc2626", // c6 红
  "#65a30d", // c7 橄榄
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

/** 键对应的稳定 class 名("nre-c3"),配 styles.css 的 .nre-cN 上色。 */
export function colorClassForKey(key: string): string {
  return `nre-c${colorIndexForKey(key)}`;
}

/** 键对应的十六进制颜色,给 SVG 内联 stroke/fill 用(不依赖 CSS 加载)。 */
export function colorHexForKey(key: string): string {
  return NRE_PALETTE[colorIndexForKey(key)];
}
