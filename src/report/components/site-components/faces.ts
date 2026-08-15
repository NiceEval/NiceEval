import type { HeroData } from "./content.ts";
import type { TextContext } from "../../definition/tree.ts";
import {
  localeText,
  resolveLocalizedText,
  type LocalizedText,
} from "../../model/locale.ts";
import { wrapDisplay } from "../../model/text-layout.ts";
import type { HeroBrandProps } from "./hero-types.ts";

/** ISO instant to a stable terminal-friendly local-time value. */
function formatDateTimeMinute(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  const pad = (part: number): string => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The HeroCard terminal face.  It contains every textual Hero fact but omits
 * visual-only logo and attribution markup.
 */
export function heroCardText(
  title: LocalizedText,
  data: HeroData,
  branding: HeroBrandProps,
  context: TextContext,
): string {
  const meta =
    data.latestStartedAt === null
      ? localeText(context.locale, "hero.noRuns")
      : [
          localeText(context.locale, "hero.lastRun", { time: formatDateTimeMinute(data.latestStartedAt) }),
          ...(data.runs > 1 ? [localeText(context.locale, "hero.composedSnapshots", { n: data.runs })] : []),
        ].join(" · ");
  const lines = [resolveLocalizedText(title, context.locale)];
  if (branding.description !== undefined) {
    lines.push(...wrapDisplay(resolveLocalizedText(branding.description, context.locale), context.width));
  }
  for (const link of branding.links ?? []) {
    const label = resolveLocalizedText(link.label, context.locale);
    lines.push(label === link.href ? label : `${label} (${link.href})`);
  }
  lines.push(meta);
  return lines.join("\n");
}
