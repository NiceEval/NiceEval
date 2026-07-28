// view 前端 i18n:内核(插值/归一)在 src/i18n/core.ts;这里只注入
// localStorage + navigator 的 locale 来源与 en 默认值。字典与 CLI 侧分开维护。
// 词条只覆盖宿主机器(导航标签、attempt dialog 的关闭按钮):页面内容(hero、警告、列表、瀑布、
// attempt 详情)是报告组件,文案在 niceeval/report 的组件词典里(src/report/locale.ts)。

import { interpolate, normalizeLocale, type Locale, type Vars } from "../../i18n/core.ts";

export type MessageKey = "nav.label" | "hero.title" | "action.close" | "dialog.attemptTitle";

type Dictionary = globalThis.Record<MessageKey, string>;

const dictionaries: globalThis.Record<Locale, Dictionary> = {
  en: {
    "nav.label": "Report",
    // 标题回退链终点的内置文案(shell.md:「Eval 运行结果 / Eval Record」);
    // 正常路径 server 侧已走完回退链,这里只兜旧数据 / 缺声明。
    "hero.title": "Eval Record",
    "action.close": "Close",
    // 屏幕阅读器专用(Radix Dialog 的可访问标题),视觉上不出现——内容本身的身份 / verdict
    // 已经在 dialog 里可见。
    "dialog.attemptTitle": "Attempt details",
  },
  "zh-CN": {
    "nav.label": "报告",
    "hero.title": "Eval 运行结果",
    "action.close": "关闭",
    "dialog.attemptTitle": "Attempt 详情",
  },
};

const storageKey = "niceeval:view:locale";

export function detectLocale(): Locale {
  const stored = readStoredLocale();
  if (stored) return stored;
  const candidates = typeof navigator === "undefined" ? [] : [navigator.language, ...(navigator.languages ?? [])];
  return candidates.some((value) => normalizeLocale(value) === "zh-CN") ? "zh-CN" : "en";
}

export function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(storageKey, locale);
  } catch {
    // Reports must still work from local files and locked-down browsers.
  }
}

// 浏览器 <title> 是宿主文档单例,唯一归属是 App 的 shellTitle effect(外壳标题回退链);
// 这里只切文档语言,不碰标题。
export function setDocumentLocale(locale: Locale): void {
  document.documentElement.lang = locale;
}

export function makeTranslator(locale: Locale): (key: MessageKey, vars?: Vars) => string {
  return (key, vars) => interpolate(dictionaries[locale][key], vars);
}

function readStoredLocale(): Locale | undefined {
  try {
    const value = localStorage.getItem(storageKey);
    return value === "zh-CN" || value === "en" ? value : undefined;
  } catch {
    return undefined;
  }
}
