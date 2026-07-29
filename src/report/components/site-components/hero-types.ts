import type { LocalizedText } from "../../model/locale.ts";

/** Hero 顶部的产品标记。src 与原生 img 一样接收浏览器可读取的 URL。 */
export interface HeroLogo {
  src: string;
  alt: LocalizedText;
}

/** Hero 内的一条主要外链。 */
export interface HeroLink {
  label: LocalizedText;
  href: string;
}

/** Hero / HeroCard 共用的可选品牌内容。 */
export interface HeroBrandProps {
  logo?: HeroLogo;
  description?: LocalizedText;
  links?: readonly HeroLink[];
}
