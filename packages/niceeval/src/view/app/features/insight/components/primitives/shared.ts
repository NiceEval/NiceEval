/** Plain, browser-only values shared by the mechanically ported legacy primitives. */
export type ReportLocale = "en" | "zh-CN";

export type LocalizedText = string | Readonly<{
  en?: string;
  "zh-CN"?: string;
  [locale: string]: string | undefined;
}>;

export type ClosedAssertionFactValue =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "value"; readonly value: null | boolean | number | string }
  | { readonly kind: "unavailable"; readonly reason: string }
  | {
      readonly kind: "fields";
      readonly fields: readonly {
        readonly label: string;
        readonly value: ClosedAssertionFactValue;
      }[];
    }
  | { readonly kind: "list"; readonly items: readonly ClosedAssertionFactValue[] };

export type ClosedJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ClosedJsonValue[]
  | { readonly [key: string]: ClosedJsonValue };

export function resolveLocalizedText(value: LocalizedText, locale: ReportLocale): string {
  if (typeof value === "string") return value;
  return value[locale] ?? value.en ?? Object.values(value).find((entry): entry is string => typeof entry === "string") ?? "";
}

export function cx(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(" ");
}

export type ValueProps<Data, Presentation = object> = { readonly data: Data } & Presentation;

export function isObject(value: unknown): value is globalThis.Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isLocalizedText(value: unknown): value is LocalizedText {
  if (typeof value === "string") return true;
  return isObject(value) && Object.values(value).every((entry) => typeof entry === "string");
}

export function dataShapeError(component: string, dataName: string, shape: string, problem: string): Error {
  return new Error(`<${component}> received invalid ${shape} from ${dataName}: ${problem}.`);
}

export function stripControl(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

export function normalizeTurnLabel(value: string): string {
  const match = /^turn[-_ ]?(\d+)$/i.exec(value);
  return match === null ? value : `Turn ${match[1]}`;
}

export function formatDurationMs(value: number): string {
  if (value < 1_000) return `${Math.round(value)}ms`;
  const seconds = Math.round(value / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export function formatPlainNumber(value: number, locale: ReportLocale = "en"): string {
  return new Intl.NumberFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    maximumFractionDigits: 12,
    maximumSignificantDigits: 12,
  }).format(value);
}

export function formatPoints(value: number, locale: ReportLocale = "en"): string {
  const amount = formatPlainNumber(value, locale);
  return `${amount} ${value === 1 ? "pt" : "pts"}`;
}

export function formatInstant(value: string, locale: ReportLocale): string {
  const instant = new Date(value);
  return Number.isNaN(instant.valueOf()) ? value : instant.toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US");
}

export function formatUSD(value: number): string {
  const absolute = Math.abs(value);
  if (absolute !== 0 && absolute < 0.000000001) return `$${value.toExponential(4)}`;
  const digits = absolute === 0 || absolute >= 1 ? 6 : Math.min(12, Math.max(2, Math.ceil(-Math.log10(absolute)) + 5));
  return `$${value.toFixed(digits).replace(/(?:\.0+|(?:(\.[0-9]*?)0+))$/, "$1")}`;
}
