import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json" with { type: "json" };
import zhCN from "./locales/zh-CN.json" with { type: "json" };

export const resources = {
  en,
  "zh-CN": zhCN,
} as const;

export type TranslationKey = keyof typeof en.translation;

const storageKey = "niceeval:report:locale";

const storedLanguage = (): keyof typeof resources => {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === "en" || value === "zh-CN") return value;
  } catch {
    // Storage is optional; browser preference remains a safe fallback.
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
};

void i18n.use(initReactI18next).init({
  resources,
  lng: storedLanguage(),
  fallbackLng: "en",
  supportedLngs: ["en", "zh-CN"],
  interpolation: { escapeValue: false },
  returnNull: false,
});

i18n.on("languageChanged", (language) => {
  document.documentElement.lang = language;
  try {
    localStorage.setItem(storageKey, language);
  } catch {
    // Language persistence is an enhancement only.
  }
});

document.documentElement.lang = i18n.resolvedLanguage ?? "en";

export default i18n;
