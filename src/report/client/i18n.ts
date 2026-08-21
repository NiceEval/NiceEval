import type { Locale } from "./types.ts";

const storageKey = "niceeval:report:locale";

const messages = {
  en: {
    close: "Close",
    details: "Details",
    loading: "Loading…",
    loadingDetails: "Loading details…",
    unableToLoad: "Unable to load this page.",
    unableToLoadDetails: "Unable to load details.",
    retry: "Retry",
  },
  "zh-CN": {
    close: "关闭",
    details: "详情",
    loading: "正在加载…",
    loadingDetails: "正在加载详情…",
    unableToLoad: "无法加载此页面。",
    unableToLoadDetails: "无法加载详情。",
    retry: "重试",
  },
} as const;

export type MessageKey = keyof (typeof messages)["en"];

export function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "en" || saved === "zh-CN") return saved;
  } catch {
    // Private browsing and file:// reports can deny storage.
  }
  return navigator.languages.some((language) => language.toLowerCase().startsWith("zh")) ? "zh-CN" : "en";
}

export function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(storageKey, locale);
  } catch {
    // Locale persistence is an enhancement only.
  }
}

export function message(locale: Locale, key: MessageKey): string {
  return messages[locale][key];
}
