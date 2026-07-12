// flag():把 experiment 声明的 flags 当维度或轴(docs/feature/reports/library.md「维度与 flags」)。
// 变量来自配置,不来自命名 —— 报告不解析 experiment id 字符串抠变量。

import type { FlagRef } from "./types.ts";

export function flag(
  name: string,
  opts?: {
    /** 组标签 / 轴标签;函数形态把声明值折成组名(如 `(v) => \`${v} agents\``)。 */
    label?: string | ((value: string | number | boolean) => string);
    unit?: string;
  },
): FlagRef {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("flag: name must be a non-empty string (the key declared in the experiment's flags).");
  }
  return { kind: "flag", name, label: opts?.label, unit: opts?.unit };
}
