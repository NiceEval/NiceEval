import type {
  SiteNoticeLevel,
  SiteWarning,
} from "./content.ts";
import {
  localeText,
  resolveLocalizedText,
  type ReportLocale,
} from "../../model/locale.ts";

export interface SiteWarningNotice {
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly action: string | null;
  readonly level: SiteNoticeLevel;
  readonly experimentId?: string;
  readonly badge?: string;
}

export interface ScopeWarningGroup {
  readonly title: string;
  readonly badges: readonly { readonly kind: string; readonly text: string }[];
  readonly headCommand: string | null;
  readonly issues: readonly SiteWarningNotice[];
}

export interface GroupedScopeWarnings {
  readonly summary: string;
  readonly groups: readonly ScopeWarningGroup[];
  readonly detailsOpen: boolean;
}

/** Converts a closed warning DTO into the presentation vocabulary. */
export const NoticeCatalog = {
  of(warning: SiteWarning, locale: ReportLocale): SiteWarningNotice {
    const title = warning.title === undefined
      ? warning.code === "unfinished-run"
        ? localeText(locale, "issues.badge.unfinishedSnapshot")
        : warning.code
      : resolveLocalizedText(warning.title, locale);
    return {
      code: warning.code,
      title,
      detail: resolveLocalizedText(warning.message, locale),
      action: warning.action ?? null,
      level: warning.level ?? (warning.code === "unreadable-run" ? "error" : "warning"),
      ...(warning.experimentId === undefined ? {} : { experimentId: warning.experimentId }),
      ...(warning.badge === undefined ? {} : { badge: resolveLocalizedText(warning.badge, locale) }),
    };
  },
};

function dedupeCommand(items: readonly SiteWarningNotice[]): string | null {
  const commands = [...new Set(items.flatMap((item) => item.action === null ? [] : [item.action]))];
  return commands.length === 1 ? commands[0]! : null;
}

function groupTitle(code: string, count: number, locale: ReportLocale): string {
  return code === "unreadable-run"
    ? localeText(locale, `issues.group.unreadableSnapshot.${count === 1 ? "one" : "other"}`, { n: count })
    : code;
}

/**
 * Groups warnings by the next useful action.  Experiment-scoped warnings are
 * grouped first and all remaining code groups follow in deterministic order.
 */
export function groupScopeWarnings(
  input: readonly SiteWarning[],
  locale: ReportLocale,
): GroupedScopeWarnings {
  const notices = input.map((warning) => NoticeCatalog.of(warning, locale));
  const byExperiment = new Map<string, SiteWarningNotice[]>();
  const byCode = new Map<string, SiteWarningNotice[]>();
  for (const notice of notices) {
    if (notice.experimentId !== undefined) {
      const items = byExperiment.get(notice.experimentId) ?? [];
      items.push(notice);
      byExperiment.set(notice.experimentId, items);
    } else {
      const items = byCode.get(notice.code) ?? [];
      items.push(notice);
      byCode.set(notice.code, items);
    }
  }

  const groups: ScopeWarningGroup[] = [];
  for (const experimentId of [...byExperiment.keys()].sort()) {
    const items = byExperiment.get(experimentId)!;
    groups.push({
      title: experimentId,
      badges: items.flatMap((item) => item.badge === undefined ? [] : [{ kind: item.code, text: item.badge }]),
      headCommand: dedupeCommand(items),
      issues: items,
    });
  }
  for (const code of [...byCode.keys()].sort()) {
    const items = byCode.get(code)!;
    groups.push({
      title: groupTitle(code, items.length, locale),
      badges: items.flatMap((item) => item.badge === undefined ? [] : [{ kind: item.code, text: item.badge }]),
      headCommand: dedupeCommand(items),
      issues: items,
    });
  }

  const summaryParts: string[] = [];
  if (byExperiment.size > 0) {
    summaryParts.push(localeText(locale, `issues.summary.experiments.${byExperiment.size === 1 ? "one" : "other"}`, {
      n: byExperiment.size,
    }));
  }
  for (const code of [...byCode.keys()].sort()) {
    const items = byCode.get(code)!;
    summaryParts.push(groupTitle(code, items.length, locale));
  }
  return Object.freeze({
    summary: summaryParts.join(" · "),
    groups: Object.freeze(groups),
    detailsOpen: notices.length <= 3,
  });
}
