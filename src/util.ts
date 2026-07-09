// 小工具。

import { t } from "./i18n/index.ts";

/** 读必需的环境变量,缺了就清晰报错(agent 鉴权用)。 */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    throw new Error(t("util.requiredEnv", { name }));
  }
  return v;
}

/** 取环境变量,缺了返回 undefined。 */
export function getEnv(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

/** 去掉 JS/TS 注释(块注释 + 行注释),好让断言只对真实代码生效,不被注释里的迁移说明误伤。 */
export function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * 把 catch 到的 e 转成报告用字符串。优先带 stack(定位到 eval 脚本抛错的具体 file:line),
 * 只在没有 stack 时才退化到 `name: message`。EvalResult.error 走这个,别再手写
 * `e instanceof Error ? e.message : String(e)`——那样用户永远看不出错误发生在哪一行。
 */
export function formatThrown(e: unknown): string {
  if (e instanceof Error) return e.stack ?? `${e.name}: ${e.message}`;
  return String(e);
}

/** 零填充到 4 位(数据集扇出的 id:sql/0000)。 */
export function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

/**
 * 在文本里维护一个带 BEGIN/END 标记的托管区块(AGENTS.md 的 niceeval 区块用)。
 * 标记已存在 → 只替换两个标记之间的内容(升级时刷新指引,区块外的用户内容不动);
 * 不存在 → 追加到末尾(与已有内容之间空一行)。
 */
export function upsertManagedBlock(source: string, begin: string, end: string, content: string): string {
  const block = `${begin}\n${content}\n${end}`;
  const beginIdx = source.indexOf(begin);
  const endIdx = source.indexOf(end);
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    return source.slice(0, beginIdx) + block + source.slice(endIdx + end.length);
  }
  if (source.trim() === "") return `${block}\n`;
  return `${source.replace(/\n*$/, "")}\n\n${block}\n`;
}

/** 把任意值安全地转成简短字符串(报告 / 日志用)。 */
export function brief(value: unknown, max = 200): string {
  let s: string;
  try {
    s = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s.length > max) return s.slice(0, max) + "…";
  return s;
}
