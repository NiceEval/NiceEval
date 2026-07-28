// Callouts:分级提示区,按上层给定的分组渲染 Notice(docs/feature/reports/components/primitives/callouts.md)。

import type { ReactElement, ReactNode } from "react";
import type { SourceInput } from "../../source.ts";
import {
  dataShapeError,
  isLocalizedText,
  isObject,
  type DataProps,
} from "../../components/shared.ts";
import { defineComponent } from "../tree.ts";
import {
  calloutDetailsLabel,
  calloutsSummary,
  countCalloutItems,
  effectiveGroupCommand,
  flattenRenderableGroups,
  formatCalloutMessage,
  isEmptyCallouts,
  maxCalloutLevel,
  type CalloutGroup,
  type CalloutItem,
  type CalloutLevel,
} from "./callouts-logic.ts";
import { resolveLocalizedText, type ReportLocale } from "../../model/locale.ts";

function cx(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export type { CalloutGroup, CalloutItem, CalloutLevel };

export type CalloutsProps<Input extends SourceInput = SourceInput> = DataProps<
  readonly CalloutGroup[],
  globalThis.Record<never, never>,
  { locale?: ReportLocale; className?: string },
  Input
>;

function validateCalloutItem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an object`;
  if (value.level !== "error" && value.level !== "warning" && value.level !== "info") {
    return `"${path}.level" must be error | warning | info`;
  }
  if (!isLocalizedText(value.message)) return `"${path}.message" must be a LocalizedText`;
  return null;
}

function validateCalloutGroup(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be an object`;
  if (!isLocalizedText(value.title)) return `"${path}.title" must be a LocalizedText`;
  if (!Array.isArray(value.items)) return `"${path}.items" must be an array`;
  for (let i = 0; i < value.items.length; i++) {
    const problem = validateCalloutItem(value.items[i], `${path}.items[${i}]`);
    if (problem !== null) return problem;
  }
  return null;
}

function assertCalloutsData(data: unknown): readonly CalloutGroup[] {
  if (!Array.isArray(data)) {
    throw dataShapeError("Callouts", "sampleNoticesContent", "CalloutGroup[]", '"data" must be an array');
  }
  for (let i = 0; i < data.length; i++) {
    const problem = validateCalloutGroup(data[i], `data[${i}]`);
    if (problem !== null) throw dataShapeError("Callouts", "sampleNoticesContent", "CalloutGroup[]", problem);
  }
  return data as readonly CalloutGroup[];
}

function CommandBlock({ command }: { command: string }): ReactElement {
  return (
    <code className="nre-callout-command" data-nre-copy={command}>
      {command}
    </code>
  );
}

function CalloutGroupWeb({
  group,
  locale,
  detailsOpen,
}: {
  group: CalloutGroup;
  locale: ReportLocale;
  detailsOpen: boolean;
}): ReactElement {
  const headCommand = effectiveGroupCommand(group);
  const nested = group.groups;
  return (
    <li className="nre-callout-group">
      <div className={cx("nre-callout-head", `nre-callout-head--${maxCalloutLevel([group])}`)}>
        <span className="nre-callout-title">{resolveLocalizedText(group.title, locale)}</span>
        {group.badges?.map((badge, i) => (
          <span key={i} className="nre-callout-badge">
            {resolveLocalizedText(badge, locale)}
          </span>
        ))}
        {headCommand !== null ? <CommandBlock command={headCommand} /> : null}
      </div>
      {group.items.length > 0 ? (
        <details className="nre-callout-details" open={detailsOpen || undefined}>
          <summary>{calloutDetailsLabel(locale, group.items.length)}</summary>
          <ul className="nre-callout-items">
            {group.items.map((item, i) => (
              <li key={i} className={cx("nre-callout-item", `nre-callout-item--${item.level}`)}>
                <span className="nre-callout-message">{formatCalloutMessage(item, locale)}</span>
                {headCommand === null && item.command !== undefined ? <CommandBlock command={item.command} /> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {nested && nested.length > 0 ? (
        <ul className="nre-callout-nested">
          {flattenRenderableGroups(nested).map((child, i) => (
            <CalloutGroupWeb key={i} group={child} locale={locale} detailsOpen={detailsOpen} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function calloutsWeb(groups: readonly CalloutGroup[], locale: ReportLocale, className?: string): ReactNode {
  if (isEmptyCallouts(groups)) return null;
  const flat = flattenRenderableGroups(groups);
  const detailsOpen = countCalloutItems(groups) <= 3;
  const level = maxCalloutLevel(groups);
  return (
    <div className={cx("nre", "nre-callouts", className)}>
      <details className="nre-callouts-root">
        <summary className={cx("nre-callouts-summary", `nre-callouts-summary--${level}`)}>
          {calloutsSummary(groups, locale)}
        </summary>
        <ul className="nre-callout-groups">
          {flat.map((group, i) => (
            <CalloutGroupWeb key={i} group={group} locale={locale} detailsOpen={detailsOpen} />
          ))}
        </ul>
      </details>
    </div>
  );
}

function calloutGroupText(group: CalloutGroup, locale: ReportLocale, indent: string): string[] {
  const lines: string[] = [];
  const headCommand = effectiveGroupCommand(group);
  const badges =
    group.badges && group.badges.length > 0
      ? ` — ${group.badges.map((badge) => resolveLocalizedText(badge, locale)).join(" · ")}`
      : "";
  const command = headCommand !== null ? ` → ${headCommand}` : "";
  lines.push(`${indent}! ${resolveLocalizedText(group.title, locale)}${badges}${command}`);
  for (const item of group.items) {
    const itemCommand = headCommand === null && item.command !== undefined ? ` → ${item.command}` : "";
    lines.push(`${indent}  ! ${formatCalloutMessage(item, locale)}${itemCommand}`);
  }
  if (group.groups) {
    for (const child of flattenRenderableGroups(group.groups)) {
      lines.push(...calloutGroupText(child, locale, `${indent}  `));
    }
  }
  return lines;
}

function calloutsText(groups: readonly CalloutGroup[], locale: ReportLocale): string {
  if (isEmptyCallouts(groups)) return "";
  const flat = flattenRenderableGroups(groups);
  const lines: string[] = [`! ${calloutsSummary(groups, locale)}`];
  for (const group of flat) lines.push(...calloutGroupText(group, locale, ""));
  return lines.join("\n");
}

export const Callouts = defineComponent<CalloutsProps>({
  dimensions: () => ({}),
  web(props, ctx) {
    const data = assertCalloutsData(props.data ?? []);
    const locale = props.locale ?? ctx.locale;
    return calloutsWeb(data, locale, props.className);
  },
  text(props, ctx) {
    const data = assertCalloutsData(props.data ?? []);
    const locale = props.locale ?? ctx.locale;
    return calloutsText(data, locale);
  },
});
Callouts.displayName = "Callouts";
