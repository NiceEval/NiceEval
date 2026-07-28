// 站点身份件(Hero / HeroCard / PoweredBy)与官方组合件;数据经 sources.* + 原语装配。

import { defineComponent } from "../../definition/tree.ts";
import { defineComposition } from "../../source.ts";
import { Callouts, CopyBlock } from "../../definition/primitives.tsx";
import { sources } from "../../sources.ts";
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

export {
  validateCopyFixPromptData,
  validateHeroData,
  validateScopeWarningsData,
  validateSnapshotDiagnosticsData,
  validateTraceWaterfallData,
};

const assertHeroData = (data: unknown): HeroData => {
  const problem = validateHeroData(data);
  if (problem !== null) throw dataShapeError("HeroCard", "heroData", "HeroData", problem);
  return data as HeroData;
};

export interface HeroProps {
  title?: LocalizedText;
  className?: string;
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

export const Hero = defineComposition<HeroProps>(async ({ title, className }, ctx) => {
  const data = await ctx.resolve(sources.site.hero);
  return <HeroCard title={title ?? ctx.report.title} data={data} className={className} />;
});
Hero.displayName = "Hero";

export const PoweredBy = defineComponent<globalThis.Record<never, never>>({
  dimensions: () => ({}),
  web: () => <PoweredByWeb />,
  text: () => "",
});
PoweredBy.displayName = "PoweredBy";

export const SampleNotices = defineComposition<ChromeProps>((props) => (
  <Callouts source={sources.sample.notices} locale={props.locale} className={props.className} />
));
SampleNotices.displayName = "SampleNotices";

export const RunNotices = defineComposition<ChromeProps>((props) => (
  <Callouts source={sources.run.diagnostics} locale={props.locale} className={props.className} />
));
RunNotices.displayName = "RunNotices";

export const SampleFixPrompt = defineComposition<ChromeProps>((props) => (
  <CopyBlock source={sources.sample.fixPrompt} locale={props.locale} className={props.className} />
));
SampleFixPrompt.displayName = "SampleFixPrompt";
