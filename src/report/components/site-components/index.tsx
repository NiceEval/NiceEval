/** Report site identity and notice components over already-closed display data. */

import type { Sample } from "../../../analysis/index.ts";
import { defineComponent } from "../../definition/tree.ts";
import { Callouts, CopyBlock } from "../../definition/primitives.tsx";
import {
  DEFAULT_REPORT_LOCALE,
  type LocalizedText,
  type ReportLocale,
} from "../../model/locale.ts";
import type {
  CopyFixPromptData,
  HeroData,
  SiteCalloutContent,
  SiteWarning,
  SnapshotDiagnosticsData,
} from "./content.ts";
import {
  runNoticesContent,
  sampleFixPromptContent,
  sampleNoticesContent,
} from "./projections.ts";
import { heroData, sampleWarningsData } from "./compute.ts";
import { heroCardText } from "./faces.ts";
import { HeroCard as HeroCardWeb } from "./HeroCard.tsx";
import type { HeroBrandProps, HeroLink, HeroLogo } from "./hero-types.ts";
import { PoweredBy as PoweredByWeb } from "./PoweredBy.tsx";
import {
  closedDataError,
  validateCopyFixPromptData,
  validateHeroData,
  validateScopeWarningsData,
  validateSnapshotDiagnosticsData,
} from "./validators.ts";

export {
  validateCopyFixPromptData,
  validateHeroData,
  validateScopeWarningsData,
  validateSnapshotDiagnosticsData,
  validateTraceWaterfallData,
} from "./validators.ts";
export type {
  ClosedDiagnostic,
  ClosedFailureSummary,
  CopyFixPromptContent,
  CopyFixPromptData,
  HeroData,
  SiteCalloutContent,
  SiteCalloutGroup,
  SiteCalloutItem,
  SiteNoticeLevel,
  SiteWarning,
  SnapshotDiagnosticsData,
  SnapshotDiagnosticsItem,
  TraceSpanSummary,
  TraceWaterfallData,
  TraceWaterfallRow,
  WaterfallContent,
  WaterfallNodeContent,
  WaterfallRowContent,
} from "./content.ts";
export type { HeroLink, HeroLogo } from "./hero-types.ts";

function classNames(...parts: readonly (string | undefined)[]): string {
  return parts.filter((part): part is string => part !== undefined && part.length > 0).join(" ");
}

function assertData<T>(component: string, shape: string, value: unknown, validate: (value: unknown) => string | null): T {
  const problem = validate(value);
  if (problem !== null) throw closedDataError(component, shape, problem);
  return value as T;
}

export interface HeroCardProps extends HeroBrandProps {
  readonly title: LocalizedText;
  readonly data: HeroData;
  readonly className?: string;
}

/** A dual-face site identity primitive over a closed HeroData value. */
export const HeroCard = defineComponent<HeroCardProps>({
  dimensions: () => ({}),
  web: (props, context) => {
    assertData<HeroData>("HeroCard", "HeroData", props.data, validateHeroData);
    return <HeroCardWeb {...props} locale={context.locale} />;
  },
  text: (props, context) => {
    assertData<HeroData>("HeroCard", "HeroData", props.data, validateHeroData);
    return heroCardText(props.title, props.data, props, context);
  },
});
HeroCard.displayName = "HeroCard";

export interface HeroProps extends HeroBrandProps {
  /** Optional title override; the Report title remains the default. */
  readonly title?: LocalizedText;
  /** Optional explicit fixed Sample; omitted means the resolving component's `ctx.scope`. */
  readonly input?: Sample;
  /** A pre-closed value for built-ins that already loaded the page data. */
  readonly data?: HeroData;
  readonly className?: string;
}

/**
 * Report-owned Hero composition. It provides a zero-config form while
 * allowing built-ins to pass already-closed data from their Page loader.
 */
export const Hero = defineComponent<HeroProps>((props, context) => {
  const data = props.data ?? heroData((props.input ?? context.scope).snapshot.runs);
  return (
    <HeroCard
      title={props.title ?? context.report.title}
      data={data}
      className={props.className}
      logo={props.logo}
      description={props.description}
      links={props.links}
    />
  );
});
Hero.displayName = "Hero";

type EmptyProps = { readonly children?: never };

/** The attribution primitive is visual-only in terminal output. */
export const PoweredBy = defineComponent<EmptyProps>({
  dimensions: () => ({}),
  web: () => <PoweredByWeb />,
  text: () => "",
});
PoweredBy.displayName = "PoweredBy";

export interface SampleNoticesProps {
  /** Optional explicit fixed Sample; omitted means the resolving component's `ctx.scope`. */
  readonly input?: Sample;
  /** A pre-closed warning set may be supplied by a built-in Page loader. */
  readonly data?: readonly SiteWarning[];
  readonly locale?: ReportLocale;
  readonly className?: string;
}

export interface RunNoticesProps {
  readonly data: SnapshotDiagnosticsData;
  readonly locale?: ReportLocale;
  readonly className?: string;
}

export interface SampleFixPromptProps {
  readonly data: CopyFixPromptData;
  readonly locale?: ReportLocale;
  readonly className?: string;
}

/** Converts closed product groups to the neutral Callouts primitive contract. */
function calloutGroups(content: SiteCalloutContent | null) {
  return content?.groups.map((group) => ({
    title: group.title,
    ...(group.headCommand === null ? {} : { command: group.headCommand }),
    ...(group.badges.length === 0 ? {} : { badges: group.badges }),
    items: group.items.map((item) => ({
      level: item.level,
      message: item.message,
      ...(item.command === undefined ? {} : { command: item.command }),
    })),
  })) ?? [];
}

/** Renders fixed-Sample completeness/selection notices or an explicitly closed warning set. */
export const SampleNotices = defineComponent<SampleNoticesProps>((props, context) => {
  const data = props.data ?? sampleWarningsData((props.input ?? context.scope).snapshot);
  assertData<readonly SiteWarning[]>("SampleNotices", "SiteWarning[]", data, validateScopeWarningsData);
  return <Callouts
    items={calloutGroups(sampleNoticesContent(data, props.locale ?? DEFAULT_REPORT_LOCALE))}
    locale={props.locale}
    className={props.className}
  />;
});
SampleNotices.displayName = "SampleNotices";

/** Renders supplied closed Run diagnostics; it never loads diagnostic sources. */
export const RunNotices = defineComponent<RunNoticesProps>((props) => {
  const data = assertData<SnapshotDiagnosticsData>("RunNotices", "SnapshotDiagnosticsData", props.data, validateSnapshotDiagnosticsData);
  return <Callouts
    items={calloutGroups(runNoticesContent(data, props.locale ?? DEFAULT_REPORT_LOCALE))}
    locale={props.locale}
    className={props.className}
  />;
});
RunNotices.displayName = "RunNotices";

/** A visible copy affordance for a supplied remediation prompt; terminal output intentionally stays empty. */
export const SampleFixPrompt = defineComponent<SampleFixPromptProps>((props) => {
  const data = assertData<CopyFixPromptData>("SampleFixPrompt", "CopyFixPromptData", props.data, validateCopyFixPromptData);
  return <CopyBlock
    content={sampleFixPromptContent(data, props.locale ?? DEFAULT_REPORT_LOCALE)}
    locale={props.locale}
    className={classNames("niceeval-copy-fix-prompt", props.className)}
  />;
});
SampleFixPrompt.displayName = "SampleFixPrompt";
