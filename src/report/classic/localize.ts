export type ClassicLocale = "en" | "zh-CN";

/** A literal string or a locale map accepted by the 0.12.1-style surface. */
export type LocalizedText = string | {
  readonly en: string;
  readonly "zh-CN": string;
};

const LOCALIZED_TEXT_KEYS = ["en", "zh-CN"] as const;

export function isLocalizedText(value: unknown): value is LocalizedText {
  if (typeof value === "string") {
    return true;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  if (Reflect.ownKeys(value).length !== LOCALIZED_TEXT_KEYS.length) {
    return false;
  }
  return LOCALIZED_TEXT_KEYS.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined
      || !descriptor.enumerable
      || !("value" in descriptor)
      || typeof descriptor.value !== "string"
    ) {
      return false;
    }
    return true;
  });
}

export function resolveLocalizedText(
  value: LocalizedText,
  locale: ClassicLocale,
): string {
  if (typeof value === "string") {
    return value;
  }
  if (!isLocalizedText(value)) {
    throw new TypeError(
      'LocalizedText must be a string or a locale map with exactly "en" and "zh-CN" string values',
    );
  }
  return value[locale];
}

export function resolveClassicLocale(locale: ClassicLocale | undefined): ClassicLocale {
  return locale ?? "en";
}
