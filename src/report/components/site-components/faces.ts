// HeroCard 的 text 面:同一份算好的数据,渲染成终端字符(niceeval show 的形态)。零 react、零 IO、纯同步。

import type { HeroData } from "../../model/types.ts";
import type { LocalizedText } from "../../model/locale.ts";
import type { TextContext } from "../../definition/tree.ts";
import { localeText, resolveLocalizedText } from "../../model/locale.ts";
import { formatReportDateTime } from "../../model/format.ts";

/** ISO 时间 → "YYYY-MM-DD HH:mm"(本地时区);不可解析原样返回。 */
function formatDateTimeMinute(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * HeroCard 的 text 面:标题行 + meta 行(最后运行时间;空范围为内置「暂无运行」文案;
 * 多快照时标注合成来源),不含品牌行(品牌行是纯 web 件,text 面零输出)。
 */
export function heroCardText(title: LocalizedText, data: HeroData, ctx: TextContext): string {
  const locale = ctx.locale;
  const meta =
    data.latestStartedAt === null
      ? localeText(locale, "hero.noRuns")
      : [
          localeText(locale, "hero.lastRun", { time: formatDateTimeMinute(data.latestStartedAt) }),
          ...(data.runs > 1 ? [localeText(locale, "hero.composedSnapshots", { n: data.runs })] : []),
        ].join(" · ");
  return `${resolveLocalizedText(title, locale)}\n${meta}`;
}
