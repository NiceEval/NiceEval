/**
 * Themes remain Host-owned finite tokens.  The classic facade deliberately
 * re-exports that contract instead of accepting raw CSS or script URLs.
 */
export {
  basalt,
  chalk,
  defineTheme,
  isThemeDefinition,
  themeStylesheet,
} from "../host/theme.ts";
export type {
  ReportTheme,
  ThemeColor,
  ThemeDefinition,
  ThemeFontSize,
  ThemeFontTokens,
  ThemeHex,
  ThemeRadius,
  ThemeSeries,
} from "../host/theme.ts";
