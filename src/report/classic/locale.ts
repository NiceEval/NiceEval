import type { LocalizedText } from "../../shared/types.ts";

/** Locale used when a host did not supply a report locale. */
export const DEFAULT_REPORT_LOCALE = "en";

/** Every localized Report value must close over these browser revision locales. */
export const REPORT_SUPPORTED_LOCALES = Object.freeze(["en", "zh-CN"] as const);

/**
 * Report chrome is deliberately a rendering concern.  It accepts arbitrary
 * BCP-47-ish tags because browser hosts may have a more specific locale than
 * the two bundled translations; resolution is deterministic and data-only.
 */
export type ReportLocale = string;

/**
 * A map is valid Report content only when every locale the browser revision
 * can switch to has its own text. Strings remain language-neutral content.
 */
export function hasCompleteReportLocaleMap(
  value: Readonly<Record<string, unknown>>,
): boolean {
  return REPORT_SUPPORTED_LOCALES.every((locale) =>
    Object.hasOwn(value, locale) && typeof value[locale] === "string"
  );
}

/** Selects a localized string without inventing a translation or mutating it. */
export function resolveLocalizedText(
  value: LocalizedText,
  locale: ReportLocale = DEFAULT_REPORT_LOCALE,
): string {
  if (typeof value === "string") return value;
  const exact = value[locale];
  if (exact !== undefined) return exact;

  const language = locale.split("-")[0];
  if (language !== undefined) {
    const languageMatch = Object.entries(value)
      .find(([candidate]) => candidate === language || candidate.startsWith(`${language}-`));
    if (languageMatch !== undefined) return languageMatch[1];
  }
  if (value.en !== undefined) return value.en;

  const fallback = Object.keys(value).sort(compareUtf8)[0];
  return fallback === undefined ? "" : value[fallback]!;
}

/** Stable equality for author-provided text maps, independent of key order. */
export function localizedTextEquals(left: LocalizedText, right: LocalizedText): boolean {
  if (typeof left === "string" || typeof right === "string") return left === right;
  const leftKeys = Object.keys(left).sort(compareUtf8);
  const rightKeys = Object.keys(right).sort(compareUtf8);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

/** Makes an immutable complete map, or a language-neutral string when untranslated. */
export function localizedText(en: string, translations: Readonly<Record<string, string>> = {}): LocalizedText {
  if (Object.keys(translations).length === 0) return en;
  const value = { en, ...translations };
  if (!hasCompleteReportLocaleMap(value)) {
    throw new TypeError("localized text maps must provide text for en and zh-CN");
  }
  return Object.freeze(value);
}

function compareUtf8(left: string, right: string): number {
  if (left === right) return 0;
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}
