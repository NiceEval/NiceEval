import type { LocalizedText } from "../../model/locale.ts";

/** An optional product mark shown above the report title. */
export interface HeroLogo {
  readonly src: string;
  readonly alt: LocalizedText;
}

/** A primary external link belonging to a report's product identity. */
export interface HeroLink {
  readonly label: LocalizedText;
  readonly href: string;
}

/** Optional product identity shown by Hero and HeroCard. */
export interface HeroBrandProps {
  readonly logo?: HeroLogo;
  readonly description?: LocalizedText;
  readonly links?: readonly HeroLink[];
}
