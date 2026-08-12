/**
 * Host-owned visual tokens for a Report view revision. A Theme contains data,
 * never author-provided CSS, scripts, asset paths, or renderer callbacks.
 */
export type ThemeHex = `#${string}`;

export type ThemeColor = ThemeHex | Readonly<{
  readonly light: ThemeHex;
  readonly dark: ThemeHex;
}>;

export type ThemeSeries = readonly [
  ThemeColor,
  ThemeColor,
  ThemeColor,
  ThemeColor,
  ThemeColor,
  ThemeColor,
];

export type ThemeFontTokens = Readonly<{
  readonly sans?: "system-sans" | "humanist-sans";
  readonly mono?: "system-mono";
}>;

export type ThemeFontSize = "compact" | "standard" | "comfortable";
export type ThemeRadius = "none" | "small" | "medium" | "large";

/** A closed visual-token declaration consumed by Report host renderers. */
export interface ReportTheme {
  readonly appearance?: "system" | "light" | "dark";
  readonly accent?: ThemeColor;
  readonly positive?: ThemeColor;
  readonly negative?: ThemeColor;
  readonly warning?: ThemeColor;
  readonly series?: ThemeSeries;
  readonly page?: ThemeColor;
  readonly surface?: ThemeColor;
  readonly surfaceSubtle?: ThemeColor;
  readonly border?: ThemeColor;
  readonly borderStrong?: ThemeColor;
  readonly text?: ThemeColor;
  readonly textSecondary?: ThemeColor;
  readonly textTertiary?: ThemeColor;
  readonly focus?: ThemeColor;
  readonly font?: ThemeFontTokens;
  readonly fontSize?: ThemeFontSize;
  readonly radius?: ThemeRadius;
}

// Preserve the cross-loader identity used by existing Theme author modules.
const THEME_DEFINITION = Symbol.for("@niceeval/report/host/node/ThemeDefinition");

/** An exact product of defineTheme, recognized across fresh Node loader revisions. */
export interface ThemeDefinition extends ReportTheme {
  readonly kind: "theme";
  readonly __niceevalThemeDefinition: never;
}

const COLOR_KEYS = [
  "accent",
  "positive",
  "negative",
  "warning",
  "page",
  "surface",
  "surfaceSubtle",
  "border",
  "borderStrong",
  "text",
  "textSecondary",
  "textTertiary",
  "focus",
] as const;

const THEME_KEYS = new Set<string>([
  "appearance",
  ...COLOR_KEYS,
  "series",
  "font",
  "fontSize",
  "radius",
]);

const HEX = /^#[0-9a-f]{6}$/i;
const APPEARANCES = new Set(["system", "light", "dark"]);
const SANS_FONTS = new Set(["system-sans", "humanist-sans"]);
const MONO_FONTS = new Set(["system-mono"]);
const FONT_SIZES = new Set(["compact", "standard", "comfortable"]);
const RADII = new Set(["none", "small", "medium", "large"]);

const FONT_SANS = {
  "system-sans": 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", "PingFang SC", sans-serif',
  "humanist-sans": 'ui-rounded, "Avenir Next", "Segoe UI", "PingFang SC", sans-serif',
} as const;

const FONT_MONO = {
  "system-mono": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const;

const FONT_SIZE_CSS = {
  compact: "13px",
  standard: "14px",
  comfortable: "16px",
} as const;

const RADIUS_CSS = {
  none: "0",
  small: "2px",
  medium: "8px",
  large: "16px",
} as const;

function fail(path: string, message: string): never {
  throw new TypeError(`defineTheme ${path} ${message}`);
}

function isPlainObject<T extends object>(value: T): value is T & Record<string, unknown>;
function isPlainObject(value: unknown): value is Record<string, unknown>;
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function copyColor(value: unknown, path: string): ThemeColor {
  if (typeof value === "string") {
    if (!HEX.test(value)) {
      fail(path, `must be an opaque six-digit sRGB hex (#RRGGBB), got ${JSON.stringify(value)}.`);
    }
    return value as ThemeHex;
  }
  if (!isPlainObject(value) || Object.keys(value).length !== 2) {
    fail(path, "must be #RRGGBB or { light: #RRGGBB, dark: #RRGGBB }.");
  }
  const { light, dark } = value;
  if (typeof light !== "string" || typeof dark !== "string" || !HEX.test(light) || !HEX.test(dark)) {
    fail(path, "must be #RRGGBB or { light: #RRGGBB, dark: #RRGGBB }.");
  }
  return Object.freeze({ light: light as ThemeHex, dark: dark as ThemeHex });
}

function copySeries(value: unknown): ThemeSeries {
  if (!Array.isArray(value) || value.length !== 6) {
    fail("series", "must contain exactly six colors.");
  }
  return Object.freeze(value.map((color, index) => copyColor(color, `series[${index}]`))) as ThemeSeries;
}

function copyFont(value: unknown): ThemeFontTokens {
  if (!isPlainObject(value)) fail("font", "must be an object of closed font tokens.");
  for (const key of Object.keys(value)) {
    if (key !== "sans" && key !== "mono") fail(`font.${key}`, "is not a supported font token.");
  }
  const { sans, mono } = value;
  if (sans !== undefined && (typeof sans !== "string" || !SANS_FONTS.has(sans))) {
    fail("font.sans", 'must be "system-sans" or "humanist-sans".');
  }
  if (mono !== undefined && (typeof mono !== "string" || !MONO_FONTS.has(mono))) {
    fail("font.mono", 'must be "system-mono".');
  }
  return Object.freeze({
    ...(sans === undefined ? {} : { sans: sans as ThemeFontTokens["sans"] }),
    ...(mono === undefined ? {} : { mono: mono as ThemeFontTokens["mono"] }),
  });
}

/**
 * Validates and freezes a Theme. Its finite token vocabulary deliberately
 * leaves no escape hatch for CSS, JavaScript, asset paths, or host callbacks.
 */
export function defineTheme(input: ReportTheme): ThemeDefinition {
  if (!isPlainObject(input)) fail("", "expects a plain theme object.");
  for (const key of Object.keys(input)) {
    if (!THEME_KEYS.has(key)) fail(key, "is not a supported theme token.");
  }

  if (input.appearance !== undefined && !APPEARANCES.has(input.appearance)) {
    fail("appearance", 'must be "system", "light", or "dark".');
  }
  if (input.fontSize !== undefined && !FONT_SIZES.has(input.fontSize)) {
    fail("fontSize", 'must be "compact", "standard", or "comfortable".');
  }
  if (input.radius !== undefined && !RADII.has(input.radius)) {
    fail("radius", 'must be "none", "small", "medium", or "large".');
  }

  const definition: Record<string | symbol, unknown> = {
    kind: "theme",
    ...(input.appearance === undefined ? {} : { appearance: input.appearance }),
    ...(input.series === undefined ? {} : { series: copySeries(input.series) }),
    ...(input.font === undefined ? {} : { font: copyFont(input.font) }),
    ...(input.fontSize === undefined ? {} : { fontSize: input.fontSize }),
    ...(input.radius === undefined ? {} : { radius: input.radius }),
  };
  for (const key of COLOR_KEYS) {
    const color = input[key];
    if (color !== undefined) definition[key] = copyColor(color, key);
  }
  Object.defineProperty(definition, THEME_DEFINITION, { value: true });
  return Object.freeze(definition) as unknown as ThemeDefinition;
}

export function isThemeDefinition(value: unknown): value is ThemeDefinition {
  return typeof value === "object" && value !== null &&
    (value as { readonly kind?: unknown }).kind === "theme" &&
    (value as Record<symbol, unknown>)[THEME_DEFINITION] === true;
}

/** The default dark token set for a Report host. */
export const basalt = defineTheme({
  appearance: "dark",
  accent: "#cbd6dc",
  positive: "#3ddc97",
  negative: "#ff6b6b",
  warning: "#e8b84a",
  series: ["#3987e5", "#199e70", "#c98500", "#008300", "#e66767", "#d95926"],
  page: "#050505",
  surface: "#0b0b0b",
  surfaceSubtle: "#111111",
  border: "#262626",
  borderStrong: "#343434",
  text: "#ededed",
  textSecondary: "#a1a1aa",
  textTertiary: "#74747b",
  font: { sans: "system-sans", mono: "system-mono" },
  fontSize: "compact",
  radius: "none",
});

/** The default light token set for a Report host. */
export const chalk = defineTheme({
  appearance: "light",
  accent: "#2a78d6",
  positive: "#087f5b",
  negative: "#b42318",
  warning: "#9a6700",
  series: ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#e34948", "#eb6834"],
  page: "#fafafa",
  surface: "#ffffff",
  surfaceSubtle: "#f4f4f5",
  border: "#dedee2",
  borderStrong: "#c9c9cf",
  text: "#111113",
  textSecondary: "#62636a",
  textTertiary: "#8b8d98",
  font: { sans: "system-sans", mono: "system-mono" },
  fontSize: "standard",
  radius: "medium",
});

function colorPair(color: ThemeColor): Readonly<{ readonly light: ThemeHex; readonly dark: ThemeHex }> {
  return typeof color === "string"
    ? Object.freeze({ light: color, dark: color })
    : color;
}

function colorFor(theme: ThemeDefinition, key: typeof COLOR_KEYS[number]): ThemeColor {
  return theme[key] ?? basalt[key] ?? basalt.accent!;
}

/**
 * Produces the host's fixed stylesheet from validated tokens. The returned
 * CSS is wholly package-owned: Theme authors only influence finite values.
 */
export function themeStylesheet(theme: ThemeDefinition): string {
  if (!isThemeDefinition(theme)) {
    throw new TypeError("themeStylesheet requires a ThemeDefinition from defineTheme.");
  }
  const colors = COLOR_KEYS.map((key) => {
    const value = colorPair(colorFor(theme, key));
    const cssName = key.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
    return value.light === value.dark
      ? `--niceeval-color-${cssName}:${value.light};`
      : `--niceeval-color-${cssName}:light-dark(${value.light},${value.dark});`;
  });
  const series = (theme.series ?? basalt.series!).map((color, index) => {
    const value = colorPair(color);
    return value.light === value.dark
      ? `--niceeval-color-series-${index + 1}:${value.light};`
      : `--niceeval-color-series-${index + 1}:light-dark(${value.light},${value.dark});`;
  });
  const font = { ...basalt.font, ...theme.font };
  const appearance = theme.appearance ?? basalt.appearance ?? "dark";
  const colorScheme = appearance === "system" ? "light dark" : appearance;
  const fontSize = theme.fontSize ?? basalt.fontSize ?? "compact";
  const radius = theme.radius ?? basalt.radius ?? "none";
  return `:root{color-scheme:${colorScheme};${colors.join("")}${series.join("")}--niceeval-font-sans:${FONT_SANS[font.sans ?? "system-sans"]};--niceeval-font-mono:${FONT_MONO[font.mono ?? "system-mono"]};--niceeval-font-size:${FONT_SIZE_CSS[fontSize]};--niceeval-radius:${RADIUS_CSS[radius]};}.niceeval-report{color-scheme:${colorScheme};}`;
}
