// ScopeWarnings 的聚合层:先把 Sample Issue 解释为 Notice,再按「下一步动作」组织成组,
// web / text 两面共用(docs/feature/reports/components/summaries/sample-notices.md「聚合轴是动作,不是发生顺序」)。

import type { SampleIssue } from "../../../record/types.ts";
import { localeText, type ReportLocale, type ReportMessageKey } from "../../model/locale.ts";

export interface SampleIssueNotice {
  code: string;
  title: string;
  detail: string;
  action: string | null;
  experimentId?: string;
  issue: SampleIssue;
}

/** Reports 层的 Issue→Notice policy；文案和动作不写回 Sample。 */
export const NoticeCatalog = {
  of(issue: SampleIssue, locale: ReportLocale): SampleIssueNotice {
    switch (issue.code) {
      case "unfinished-run":
        return {
          code: issue.code,
          title: localeText(locale, "issues.badge.unfinishedSnapshot"),
          detail: `${issue.experimentId} has an unfinished run from ${issue.startedAt}.`,
          action: `niceeval exp ${issue.experimentId}`,
          experimentId: issue.experimentId,
          issue,
        };
      case "dangling-evidence":
        return {
          code: issue.code,
          title: "unavailable evidence",
          detail: `${issue.experimentId}/${issue.evalId} attempt ${issue.attempt} has unavailable evidence.`,
          action: null,
          experimentId: issue.experimentId,
          issue,
        };
      case "unreadable-run":
        return {
          code: issue.code,
          title: pluralText(locale, "issues.group.unreadableSnapshot", 1),
          detail: `${issue.dir} is unreadable (${issue.reason}).`,
          action: null,
          issue,
        };
    }
  },
}

export interface ScopeWarningGroup {
  /** 实验组为 experimentId;kind 组为登记的组头文案(含条数);未登记 kind 用 kind 原文。 */
  title: string;
  /** 每条警告一枚、与 issues 同序;未登记徽标模板的成员不出徽标。 */
  badges: readonly { kind: string; text: string }[];
  /** 组内命令去重后恰一条时归组头(复制即推进整组);多条或零条为 null,命令随明细逐条走。 */
  headCommand: string | null;
  /** 原始条目(明细层,message 单源)。 */
  issues: readonly SampleIssueNotice[];
}

export interface GroupedScopeWarnings {
  /** 分类计数汇总行,任何组数下都产出;web 面用作外层折叠块的 <summary>,text 面只在多组时打印。 */
  summary: string;
  groups: readonly ScopeWarningGroup[];
  /** 警告总条数 ≤ 3 时组级明细默认展开(web 面第二层 <details> 的 open;阈值是行为契约,无开关)。 */
  detailsOpen: boolean;
}

/** 实验作用域且登记了徽标模板的 kind 才进实验组;其余(含未登记 kind)按 kind 聚合。 */
const EXPERIMENT_KINDS = new Set(["unfinished-run"]);

function pluralText(
  locale: ReportLocale,
  base: "issues.summary.experiments" | "issues.group.unreadableSnapshot" | "issues.details",
  n: number,
): string {
  return localeText(locale, `${base}.${n === 1 ? "one" : "other"}` as ReportMessageKey, { n });
}

/** 明细折叠块的标签(「N 条原始警告」)。 */
export function warningDetailsLabel(locale: ReportLocale, n: number): string {
  return pluralText(locale, "issues.details", n);
}

function badgeText(w: SampleIssueNotice, locale: ReportLocale): string | null {
  switch (w.code) {
    case "unfinished-run":
      return localeText(locale, "issues.badge.unfinishedSnapshot");
    default:
      return null;
  }
}

/** 组内命令去重:恰一条时它就是「复制即推进整组」的组头命令。 */
function dedupeCommand(members: readonly SampleIssueNotice[]): string | null {
  const actions = [...new Set(members.map((member) => member.action).filter((action): action is string => action !== null))];
  return actions.length === 1 ? actions[0]! : null;
}

/**
 * 按「用户要做什么」组织,不按发生顺序:带 experimentId 且登记了徽标模板的 kind 按实验聚合,
 * 其余(含未登记 kind)按 kind 聚合。组排序:实验作用域组在前(按实验 id 字典序),
 * 非实验作用域组在后(按 kind);类别两档制(integrity / freshness)已随旧 Run /
 * partial-coverage 一并删除——三种 warning kind 都是同一类完整性事实,不再需要档位区分
 * (docs/feature/reports/components/summaries/sample-notices.md「聚合轴是动作,不是发生顺序」)。
 */
export function groupScopeWarnings(input: readonly SampleIssue[], locale: ReportLocale): GroupedScopeWarnings {
  const issues = input.map((issue) => NoticeCatalog.of(issue, locale));
  const byExperiment = new Map<string, SampleIssueNotice[]>();
  const byKind = new Map<string, SampleIssueNotice[]>();
  for (const w of issues) {
    if (EXPERIMENT_KINDS.has(w.code) && typeof w.experimentId === "string") {
      const members = byExperiment.get(w.experimentId) ?? [];
      members.push(w);
      byExperiment.set(w.experimentId, members);
    } else {
      const members = byKind.get(w.code) ?? [];
      members.push(w);
      byKind.set(w.code, members);
    }
  }

  const groups: ScopeWarningGroup[] = [];
  // 实验作用域组在前,按实验 id 字典序(Map 插入顺序取决于扫描顺序,这里显式排序)。
  for (const experimentId of [...byExperiment.keys()].sort()) {
    const members = byExperiment.get(experimentId)!;
    groups.push({
      title: experimentId,
      badges: members
        .map((w) => ({ kind: w.code, text: badgeText(w, locale) }))
        .filter((b): b is { kind: string; text: string } => b.text !== null),
      headCommand: dedupeCommand(members),
      issues: members,
    });
  }
  // 非实验作用域组在后,按 kind 字典序。
  for (const kind of [...byKind.keys()].sort()) {
    const members = byKind.get(kind)!;
    groups.push({
      title:
        kind === "unreadable-run" ? pluralText(locale, "issues.group.unreadableSnapshot", members.length) : kind,
      badges: [],
      headCommand: dedupeCommand(members),
      issues: members,
    });
  }

  const parts: string[] = [];
  if (byExperiment.size > 0) parts.push(pluralText(locale, "issues.summary.experiments", byExperiment.size));
  for (const kind of [...byKind.keys()].sort()) {
    const members = byKind.get(kind)!;
    parts.push(
      kind === "unreadable-run"
        ? pluralText(locale, "issues.group.unreadableSnapshot", members.length)
        : `${kind} ×${members.length}`,
    );
  }

  return { summary: parts.join(" · "), groups, detailsOpen: issues.length <= 3 };
}
