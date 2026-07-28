import type { ReportAsset } from "./definition/report.ts";

export type ThemeHex = `#${string}`;
export type ThemeColor = ThemeHex | { light: ThemeHex; dark: ThemeHex };
export type ThemeSeries = readonly [ThemeColor, ThemeColor, ThemeColor, ThemeColor, ThemeColor, ThemeColor];

export interface ReportTheme {
  appearance?: "system" | "light" | "dark";
  accent?: ThemeColor;
  positive?: ThemeColor;
  negative?: ThemeColor;
  warning?: ThemeColor;
  series?: ThemeSeries;
  page?: ThemeColor;
  surface?: ThemeColor;
  surfaceSubtle?: ThemeColor;
  border?: ThemeColor;
  borderStrong?: ThemeColor;
  text?: ThemeColor;
  textSecondary?: ThemeColor;
  textTertiary?: ThemeColor;
  focus?: ThemeColor;
  font?: { sans?: string; mono?: string };
  fontSize?: string;
  radius?: string;
  styles?: readonly ReportAsset[];
}

const THEME_DEFINITION: unique symbol = Symbol.for("niceeval.report.theme");
export interface ThemeDefinition extends ReportTheme {
  readonly kind: "theme";
}

const COLORS = ["accent", "positive", "negative", "warning", "page", "surface", "surfaceSubtle", "border", "borderStrong", "text", "textSecondary", "textTertiary", "focus"] as const;
const HEX = /^#[0-9a-f]{6}$/i;
const cssName = (name: string) => name.replace(/[A-Z]/g, (x) => `-${x.toLowerCase()}`);

function fail(path: string, message: string): never {
  throw new Error(`defineTheme ${path} ${message}`);
}
function assertColor(value: unknown, path: string): asserts value is ThemeColor {
  if (typeof value === "string") {
    if (!HEX.test(value)) fail(path, `must be an opaque six-digit sRGB hex (#RRGGBB), got ${JSON.stringify(value)}.`);
    return;
  }
  if (!value || typeof value !== "object" || !HEX.test((value as { light?: unknown }).light as string) || !HEX.test((value as { dark?: unknown }).dark as string)) {
    fail(path, "must be #RRGGBB or { light: #RRGGBB, dark: #RRGGBB }.");
  }
}
function assertAssets(value: unknown): asserts value is readonly ReportAsset[] {
  if (value === undefined) return;
  if (!Array.isArray(value)) fail("styles", "must be an array of { src } or { inline }.");
  for (const [i, asset] of value.entries()) {
    const item = asset as { src?: unknown; inline?: unknown };
    if ((typeof item.src === "string") === (typeof item.inline === "string")) fail(`styles[${i}]`, 'must contain exactly one of "src" or "inline".');
    if (typeof item.src === "string" && (item.src.startsWith("/") || item.src.startsWith("~") || item.src.split(/[\\/]/).includes(".."))) {
      fail(`styles[${i}].src`, "must be a local relative path without '..', an absolute path, or '~'.");
    }
  }
}

export function defineTheme(theme: ReportTheme): ThemeDefinition {
  if (!theme || typeof theme !== "object" || Array.isArray(theme)) fail("", "expects a theme object.");
  for (const key of Object.keys(theme)) {
    if (!["appearance", ...COLORS, "series", "font", "fontSize", "radius", "styles"].includes(key)) fail(key, "is not a supported theme field.");
  }
  if (theme.appearance !== undefined && !["system", "light", "dark"].includes(theme.appearance)) fail("appearance", 'must be "system", "light", or "dark".');
  for (const key of COLORS) if (theme[key] !== undefined) assertColor(theme[key], `theme.${key}`);
  if (theme.series !== undefined) {
    if (!Array.isArray(theme.series) || theme.series.length !== 6) fail("theme.series", "must contain exactly six colors.");
    theme.series.forEach((color, i) => assertColor(color, `theme.series[${i}]`));
  }
  for (const [key, value] of Object.entries({ ...(theme.font ?? {}), fontSize: theme.fontSize, radius: theme.radius })) {
    if (value !== undefined && (typeof value !== "string" || !value || /[;}]/.test(value))) fail(`theme.${key}`, 'must be a non-empty CSS value without ";" or "}"; use styles for full CSS.');
  }
  assertAssets(theme.styles);
  const definition = { ...theme, kind: "theme" as const };
  Object.defineProperty(definition, THEME_DEFINITION, { value: true });
  return definition;
}

export function isThemeDefinition(value: unknown): value is ThemeDefinition {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "theme" &&
    (value as Record<symbol, unknown>)[THEME_DEFINITION] === true;
}

const basaltColors = {
  accent: { light: "#26323A", dark: "#CBD6DC" }, positive: { light: "#2F6B4F", dark: "#7FBFA0" },
  negative: { light: "#A33A30", dark: "#E58F86" }, warning: { light: "#7A6428", dark: "#D6BC78" },
  page: { light: "#FAFAFA", dark: "#0A0B0C" }, surface: { light: "#FFFFFF", dark: "#101214" },
  surfaceSubtle: { light: "#F2F3F4", dark: "#16191B" }, border: { light: "#E1E3E5", dark: "#22262A" },
  borderStrong: { light: "#C4C8CC", dark: "#333A40" }, text: { light: "#16191B", dark: "#E6E9EB" },
  textSecondary: { light: "#5C6469", dark: "#9AA2A8" }, textTertiary: { light: "#8A9298", dark: "#6A7278" },
} as const;
export const basalt = defineTheme({
  appearance: "system", ...basaltColors,
  series: [{ light: "#3F6B87", dark: "#A8C8DC" }, { light: "#587046", dark: "#7E9B6E" }, { light: "#8A6B2E", dark: "#E0C894" }, { light: "#5A4E7C", dark: "#9A8DBA" }, { light: "#9E4E44", dark: "#C4837B" }, { light: "#2E6F6A", dark: "#6FAAA4" }],
  font: { sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", "PingFang SC", sans-serif', mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
  fontSize: "13px", radius: "0",
  styles: [{ inline: ".niceeval-report,.niceeval-report *{box-shadow:none}.niceeval-report td,.niceeval-report .niceeval-stat-value{font-variant-numeric:tabular-nums}.niceeval-report a{text-decoration:underline;text-underline-offset:2px}.niceeval-report :focus-visible{outline:1px solid var(--niceeval-color-focus);outline-offset:0}" }],
});

function pair(value: ThemeColor | undefined, fallback: ThemeColor): { light: string; dark: string } {
  const source = value ?? fallback;
  return typeof source === "string" ? { light: source, dark: source } : source;
}
export function themeStylesheet(theme: ThemeDefinition): string {
  const all: ThemeDefinition = { ...basalt, ...theme };
  const entries = COLORS.map((key) => [cssName(key), pair(all[key], (basalt[key] ?? basalt.accent)!)]);
  const baseSeries = basalt.series!;
  const series = (all.series ?? baseSeries).map((color, i) => [`series-${i + 1}`, pair(color, baseSeries[i]!)]);
  const vars = [...entries, ...series].map(([key, color]) => {
    const resolved = color as { light: string; dark: string };
    return `--niceeval-color-${key}:light-dark(${resolved.light},${resolved.dark});`;
  }).join("");
  const font = all.font ?? basalt.font!;
  return `:root{color-scheme:${all.appearance === "light" ? "light" : all.appearance === "dark" ? "dark" : "light dark"};${vars}--niceeval-font-sans:${font.sans ?? basalt.font!.sans};--niceeval-font-mono:${font.mono ?? basalt.font!.mono};--niceeval-font-size:${all.fontSize ?? basalt.fontSize};--niceeval-radius:${all.radius ?? basalt.radius};}`;
}
