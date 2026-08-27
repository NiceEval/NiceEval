// i18n 内核:CLI(src/i18n/index.ts)与 view 前端(src/view/app/i18n.ts)共用。
// 必须保持环境无关(不 import node/browser API),vite 前端和 node CLI 都直接打包它。
// view 在此之外注入 navigator+localStorage 与默认值。

export const LOCALES = ["en", "zh-CN"] as const;
export type Locale = (typeof LOCALES)[number];

export type Vars = globalThis.Record<string, string | number | boolean | undefined>;

/** 一份字典:消息 key → 文案(可含 {{var}} 占位)。 */
export type Dictionary<K extends string = string> = globalThis.Record<K, string>;

/** 把 {{var}} 占位替换成 vars 里的值;缺失的变量替换成空串而不是保留占位。 */
export function interpolate(message: string, vars: Vars = {}): string {
  return message.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, name: string) =>
    vars[name] === undefined ? "" : String(vars[name]),
  );
}

/**
 * 把 "zh_CN"、"en-US"、navigator.language 这类原始值归一成受支持的 Locale。
 * C / POSIX 视为「未指定」返回 undefined(交给下一个候选);非中文一律落 en。
 */
export function normalizeLocale(raw: string | undefined): Locale | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase().replace("_", "-");
  if (!value || value === "c" || value === "posix") return undefined;
  return value.startsWith("zh") ? "zh-CN" : "en";
}
