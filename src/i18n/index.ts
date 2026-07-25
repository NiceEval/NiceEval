// CLI 侧 i18n:内核(插值/归一)在 core.ts;这里只注入来源(config.locale + 系统 locale)与
// zh-CN 默认值。界面语言是配置,家在 `defineConfig({ locale })`;系统 locale 是「输出到哪个
// 终端」的环境事实,只作没配时的判定依据。niceeval 自己不发明 NICEEVAL_LANG 这类配置变量
// (边界见 docs/architecture.md「配置从代码来,凭据从环境来」)。

import { en } from "./en.ts";
import { zhCN, type MessageKey, type Messages } from "./zh-CN.ts";
import { interpolate, normalizeLocale, type Locale, type Vars } from "./core.ts";

export type { Locale, Vars } from "./core.ts";

const dictionaries: Record<Locale, Messages> = {
  "zh-CN": zhCN,
  en,
};

/** `defineConfig({ locale })` 的归一结果;CLI 装载配置后调 setConfiguredLocale 注入一次。 */
let configuredLocale: Locale | undefined;

/**
 * 注入项目配置声明的界面语言。传 undefined(没配 / 没有配置文件)时清空,回到系统 locale 判定。
 * 无法归一的值(如 "C")同样按未声明处理——不为一个装饰性设置让命令失败。
 */
export function setConfiguredLocale(raw: string | undefined): void {
  configuredLocale = normalizeLocale(raw);
}

export function detectLocale(env: NodeJS.ProcessEnv = process.env): Locale {
  return (
    configuredLocale ??
    normalizeLocale(env.LC_ALL) ??
    normalizeLocale(env.LC_MESSAGES) ??
    normalizeLocale(env.LANG) ??
    "zh-CN"
  );
}

export function t(key: MessageKey, vars: Vars = {}): string {
  return interpolate(dictionaries[detectLocale()][key], vars);
}
