// Callouts 的共享渲染逻辑:web / text 两面共用(docs/feature/reports/README.md)。

import { resolveLocalizedText, type LocalizedText, type ReportLocale } from "../../model/locale.ts";

export type CalloutLevel = "error" | "warning" | "info";

export interface CalloutItem {
  level: CalloutLevel;
  message: LocalizedText;
  command?: string;
  count?: number;
}

export interface CalloutGroup {
  title: LocalizedText;
  command?: string;
  badges?: readonly LocalizedText[];
  items: readonly CalloutItem[];
  groups?: readonly CalloutGroup[];
}

const LEVEL_RANK: Record<CalloutLevel, number> = { error: 3, warning: 2, info: 1 };

export function isEmptyCallouts(groups: readonly CalloutGroup[]): boolean {
  return groups.length === 0 || countCalloutItems(groups) === 0;
}

/** 嵌套组只有一个孩子时不渲染空壳层级。 */
export function flattenRenderableGroups(groups: readonly CalloutGroup[]): CalloutGroup[] {
  const out: CalloutGroup[] = [];
  for (const group of groups) {
    const nested = group.groups;
    if (group.items.length === 0 && nested?.length === 1) {
      out.push(nested[0]!);
      continue;
    }
    out.push(group);
  }
  return out;
}

export function countCalloutItems(groups: readonly CalloutGroup[]): number {
  let n = 0;
  const visit = (list: readonly CalloutGroup[]): void => {
    for (const group of list) {
      n += group.items.length;
      if (group.groups) visit(group.groups);
    }
  };
  visit(groups);
  return n;
}

export function maxCalloutLevel(groups: readonly CalloutGroup[]): CalloutLevel {
  let max: CalloutLevel = "info";
  const visit = (list: readonly CalloutGroup[]): void => {
    for (const group of list) {
      for (const item of group.items) {
        if (LEVEL_RANK[item.level] > LEVEL_RANK[max]) max = item.level;
      }
      if (group.groups) visit(group.groups);
    }
  };
  visit(groups);
  return max;
}

function uniqueItemCommands(items: readonly CalloutItem[]): string[] {
  return [...new Set(items.map((item) => item.command).filter((command): command is string => command !== undefined))];
}

/** 组头命令:组内去重后恰一条时归组头,否则 null(命令随明细逐条走)。 */
export function effectiveGroupCommand(group: CalloutGroup): string | null {
  const itemCommands = uniqueItemCommands(group.items);
  if (itemCommands.length > 1) return null;
  if (itemCommands.length === 1) return itemCommands[0]!;
  return group.command ?? null;
}

function severityWord(level: CalloutLevel, locale: ReportLocale): string {
  if (locale === "zh-CN") {
    if (level === "error") return "错误";
    if (level === "warning") return "警告";
    return "提示";
  }
  if (level === "error") return "errors";
  if (level === "warning") return "warnings";
  return "notices";
}

/** 分类计数汇总行:交代组数、条数与最高严重度。 */
export function calloutsSummary(groups: readonly CalloutGroup[], locale: ReportLocale): string {
  const flat = flattenRenderableGroups(groups);
  const itemCount = countCalloutItems(groups);
  const level = maxCalloutLevel(groups);
  const levelWord = severityWord(level, locale);
  if (flat.length === 1) {
    const title = resolveLocalizedText(flat[0]!.title, locale);
    if (locale === "zh-CN") return `${title} · ${itemCount} 条${levelWord}`;
    return `${title} · ${itemCount} ${levelWord}`;
  }
  if (locale === "zh-CN") return `${flat.length} 组 · ${itemCount} 条${levelWord}`;
  return `${flat.length} groups · ${itemCount} ${levelWord}`;
}

export function calloutDetailsLabel(locale: ReportLocale, n: number): string {
  if (locale === "zh-CN") return `${n} 条明细`;
  return n === 1 ? "1 detail" : `${n} details`;
}

export function formatCalloutMessage(item: CalloutItem, locale: ReportLocale): string {
  const message = resolveLocalizedText(item.message, locale);
  const count = item.count ?? 1;
  if (count <= 1) return message;
  if (locale === "zh-CN") return `${message} ×${count}`;
  return `${message} ×${count}`;
}
