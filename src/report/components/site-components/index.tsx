// 站点身份件(Hero / HeroCard / PoweredBy)与提示组合；取数走公开 to*，组件只接普通值。

import { defineComponent } from "../../definition/tree.ts";
import { Callouts, CopyBlock } from "../../definition/primitives.tsx";
import type { HeroData } from "../../model/types.ts";
import type { LocalizedText } from "../../model/locale.ts";
import { dataShapeError, type ChromeProps } from "../shared.ts";
import { heroCardText } from "./faces.ts";
import { HeroCard as HeroCardWeb } from "./HeroCard.tsx";
import { PoweredBy as PoweredByWeb } from "./PoweredBy.tsx";
import {
  validateCopyFixPromptData,
  validateHeroData,
  validateScopeWarningsData,
  validateSnapshotDiagnosticsData,
  validateTraceWaterfallData,
} from "./validators.ts";
import {
  toHeroData,
  toRunNotices,
  toSampleFixPrompt,
  toSampleNotices,
} from "../../model/conversions.ts";
import type { Sample } from "../../../record/types.ts";

export {
  validateCopyFixPromptData,
  validateHeroData,
  validateScopeWarningsData,
  validateSnapshotDiagnosticsData,
  validateTraceWaterfallData,
};

const assertHeroData = (data: unknown): HeroData => {
  const problem = validateHeroData(data);
  if (problem !== null) throw dataShapeError("HeroCard", "toHeroData", "HeroData", problem);
  return data as HeroData;
};

export interface HeroProps {
  title?: LocalizedText;
  className?: string;
  /** 显式 Sample；省略时用 ComposeContext.scope。 */
  input?: Sample;
}

export interface HeroCardProps {
  title: LocalizedText;
  data: HeroData;
  className?: string;
}

export const HeroCard = defineComponent<HeroCardProps>({
  dimensions: () => ({}),
  web: (props, ctx) => {
    assertHeroData(props.data);
    return <HeroCardWeb title={props.title} data={props.data} className={props.className} locale={ctx.locale} />;
  },
  text: (props, ctx) => {
    assertHeroData(props.data);
    return heroCardText(props.title, props.data, ctx);
  },
});
HeroCard.displayName = "HeroCard";

export const Hero = defineComponent<HeroProps>(async ({ title, className, input }, ctx) => {
  const data = await toHeroData(input ?? ctx.scope);
  return <HeroCard title={title ?? ctx.report.title} data={data} className={className} />;
});
Hero.displayName = "Hero";

export const PoweredBy = defineComponent<globalThis.Record<never, never>>({
  dimensions: () => ({}),
  web: () => <PoweredByWeb />,
  text: () => "",
});
PoweredBy.displayName = "PoweredBy";

export type SampleNoticesProps = ChromeProps & { input?: Sample };
export type RunNoticesProps = ChromeProps & { input?: Sample };
export type SampleFixPromptProps = ChromeProps & { input?: Sample };

export const SampleNotices = defineComponent<SampleNoticesProps>(async (props, ctx) => {
  const items = await toSampleNotices(props.input ?? ctx.scope);
  return <Callouts items={items} locale={props.locale} className={props.className} />;
});
SampleNotices.displayName = "SampleNotices";

export const RunNotices = defineComponent<RunNoticesProps>(async (props, ctx) => {
  const items = await toRunNotices(props.input ?? ctx.scope);
  return <Callouts items={items} locale={props.locale} className={props.className} />;
});
RunNotices.displayName = "RunNotices";

export const SampleFixPrompt = defineComponent<SampleFixPromptProps>(async (props, ctx) => {
  const content = await toSampleFixPrompt(props.input ?? ctx.scope);
  return <CopyBlock content={content} locale={props.locale} className={props.className} />;
});
SampleFixPrompt.displayName = "SampleFixPrompt";
