import { en } from "./en.ts";
import { zhCN, type MessageKey, type Messages } from "./zh-CN.ts";

export type Locale = "zh-CN" | "en";

type Vars = Record<string, string | number | boolean | undefined>;

const dictionaries: Record<Locale, Messages> = {
  "zh-CN": zhCN,
  en,
};

function normalizeLocale(raw: string | undefined): Locale | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase().replace("_", "-");
  if (!value) return undefined;
  if (value === "c" || value === "posix") return undefined;
  if (value.startsWith("zh")) return "zh-CN";
  if (value.startsWith("en")) return "en";
  return "en";
}

export function detectLocale(env: NodeJS.ProcessEnv = process.env): Locale {
  return (
    normalizeLocale(env.FASTEVAL_LANG) ??
    normalizeLocale(env.FASTEVAL_LOCALE) ??
    normalizeLocale(env.LC_ALL) ??
    normalizeLocale(env.LC_MESSAGES) ??
    normalizeLocale(env.LANG) ??
    "zh-CN"
  );
}

export function t(key: MessageKey, vars: Vars = {}): string {
  const message = dictionaries[detectLocale()][key];
  return message.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, name: string) =>
    vars[name] === undefined ? "" : String(vars[name]),
  );
}
