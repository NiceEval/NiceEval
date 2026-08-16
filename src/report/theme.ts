import type { ReportAsset } from "./definition/report.ts";
import { resolve } from "node:path";

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
const themeSourceBases = new WeakMap<object, string>();
export interface ThemeDefinition extends ReportTheme {
  /** 与 ReportDefinition 同形的不可构造结构品牌；运行时仍由 Symbol.for 标记验证。 */
  readonly __niceevalThemeDefinition: never;
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
  return definition as ThemeDefinition;
}

export function isThemeDefinition(value: unknown): value is ThemeDefinition {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "theme" &&
    (value as Record<symbol, unknown>)[THEME_DEFINITION] === true;
}

/** @internal Records the trusted module directory used to close relative theme assets. */
export function registerThemeSourceBase(theme: ThemeDefinition, base: string): void {
  themeSourceBases.set(theme, base);
}

/** @internal The site builder never guesses a process-cwd for relative assets. */
export function themeSourceBase(theme: ThemeDefinition): string | undefined {
  return themeSourceBases.get(theme);
}

/** @internal Exact local stylesheet inputs that a view watcher must retain. */
export function themeAssetInputs(theme: ThemeDefinition | undefined): readonly string[] {
  if (theme === undefined || theme.styles === undefined) return Object.freeze([]);
  const base = themeSourceBase(theme);
  if (base === undefined) return Object.freeze([]);
  return Object.freeze(theme.styles.flatMap((asset) =>
    "src" in asset && typeof asset.src === "string" ? [resolve(base, asset.src)] : []
  ));
}

/**
 * basalt —— 官方暗色主题,也是不装任何主题时的默认观感(docs/feature/reports/architecture.md)。
 * 与 docs/SVG-DESIGN.md 的图示令牌同一份:近黑面、发丝线、零圆角、颜色只在有语义时出现。
 * 官方 stylesheet 每个 var(--niceeval-*, <兜底>) 用点的兜底值抄的就是这里,
 * test/unit/report-theme-tokens.test.ts 守护逐项相等,所以 basalt 不需要自带 styles。
 */
export const basalt = defineTheme({
  appearance: "dark",
  accent: "#cbd6dc", positive: "#3ddc97", negative: "#ff6b6b", warning: "#e8b84a",
  series: ["#3987e5", "#199e70", "#c98500", "#008300", "#e66767", "#d95926"],
  page: "#050505", surface: "#0b0b0b", surfaceSubtle: "#111111",
  border: "#262626", borderStrong: "#343434",
  text: "#ededed", textSecondary: "#a1a1aa", textTertiary: "#74747b",
  font: { sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", "PingFang SC", sans-serif', mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
  fontSize: "13px", radius: "0",
});

/**
 * chalk —— 官方浅色主题(docs/feature/reports/architecture.md)。白面、圆角、蓝 accent:
 * 与 basalt 处处相反,同时证明官方样式没写死任何观感——差异完整住在主题令牌里。
 */
export const chalk = defineTheme({
  appearance: "light",
  accent: "#2a78d6", positive: "#087f5b", negative: "#b42318", warning: "#9a6700",
  series: ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#e34948", "#eb6834"],
  page: "#fafafa", surface: "#ffffff", surfaceSubtle: "#f4f4f5",
  border: "#dedee2", borderStrong: "#c9c9cf",
  text: "#111113", textSecondary: "#62636a", textTertiary: "#8b8d98",
  font: { sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", "PingFang SC", sans-serif', mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
  fontSize: "14px", radius: "8px",
});

function pair(value: ThemeColor | undefined, fallback: ThemeColor): { light: string; dark: string } {
  const source = value ?? fallback;
  return typeof source === "string" ? { light: source, dark: source } : source;
}
export function themeStylesheet(theme: ThemeDefinition): string {
  const all: ReportTheme = { ...basalt, ...theme };
  const entries = COLORS.map((key) => [cssName(key), pair(all[key], (basalt[key] ?? basalt.accent)!)]);
  const baseSeries = basalt.series!;
  const series = (all.series ?? baseSeries).map((color, i) => [`series-${i + 1}`, pair(color, baseSeries[i]!)]);
  const vars = [...entries, ...series].map(([key, color]) => {
    const resolved = color as { light: string; dark: string };
    return resolved.light === resolved.dark
      ? `--niceeval-color-${key}:${resolved.light};`
      : `--niceeval-color-${key}:light-dark(${resolved.light},${resolved.dark});`;
  }).join("");
  const font = all.font ?? basalt.font!;
  const scheme = all.appearance === "light" ? "light" : all.appearance === "dark" ? "dark" : "light dark";
  // .niceeval-report 也压一遍 color-scheme:官方 stylesheet 的兜底是 basalt 的 dark,
  // 令牌块在级联后位,锁定/放开外观都以生效主题为准(tok-* 语法高亮的 light-dark() 靠它选支)。
  return `:root{color-scheme:${scheme};${vars}--niceeval-font-sans:${font.sans ?? basalt.font!.sans};--niceeval-font-mono:${font.mono ?? basalt.font!.mono};--niceeval-font-size:${all.fontSize ?? basalt.fontSize};--niceeval-radius:${all.radius ?? basalt.radius};}.niceeval-report{color-scheme:${scheme};}`;
}
