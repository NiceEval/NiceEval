// 站点组件族(HeroCard / ScopeWarnings / TraceWaterfall)的 text 面:同一份算好的数据,
// 渲染成终端字符(niceeval show 的形态)。零 react、零 IO、纯同步。

import type { HeroData, SampleIssue, SnapshotDiagnosticsData, TraceWaterfallRow } from "../../model/types.ts";
import type { LocalizedText } from "../../model/locale.ts";
import type { TextContext } from "../../definition/tree.ts";
import { countText, localeText, resolveLocalizedText } from "../../model/locale.ts";
import { formatDurationMs, formatHistoricalGap, formatReportDateTime } from "../../model/format.ts";
import { groupScopeWarnings } from "./scope-warnings.ts";
import { groupSnapshotDiagnostics, occurrencesOf } from "./snapshot-diagnostics.ts";

/** ISO 时间 → "YYYY-MM-DD HH:mm"(本地时区);不可解析原样返回。 */
function formatDateTimeMinute(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ───────────────────────── 站点组件(HeroCard / ScopeWarnings / TraceWaterfall)─────────────────────────

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

/**
 * ScopeWarnings 的 text 面:按动作聚合(../scope-warnings.ts,与 web 面共用),同构但不折叠——
 * 多组时首行 "! <分类计数汇总>";每组一行组头 "! <标题> — <徽标> → <组头命令>",其下缩进
 * 逐条原样打印 message(已以下一步收尾,不截断掉尾段)。空警告集零输出。
 */
export function scopeWarningsText(issues: readonly SampleIssue[], ctx: TextContext): string {
  if (issues.length === 0) return "";
  const { summary, groups } = groupScopeWarnings(issues, ctx.locale);
  const lines: string[] = [];
  // 汇总行只在多组时打印;单组时组头即汇总,不另起一行(web 面则恒以汇总行作外层 <summary>)。
  if (groups.length > 1) lines.push(`! ${summary}`);
  for (const group of groups) {
    const badges = group.badges.length > 0 ? ` — ${group.badges.map((b) => b.text).join(" · ")}` : "";
    const command = group.headCommand !== null ? ` → ${group.headCommand}` : "";
    lines.push(`! ${group.title}${badges}${command}`);
    for (const notice of group.issues) lines.push(`!   ${notice.detail}`);
  }
  return lines.join("\n");
}

/**
 * SnapshotDiagnostics 的 text 面:按来源分组(../snapshot-diagnostics.ts,与 web 面共用),
 * 同构但不折叠——先打印汇总,再按 experiment → Run 打印来源、时距、每条记录的 level、
 * message、count 与 command。单诊断快照退化成一行,与 web 面同一份聚合层保证行为一致。
 * 空诊断集零输出。
 */
export function snapshotDiagnosticsText(data: SnapshotDiagnosticsData, ctx: TextContext): string {
  if (data.length === 0) return "";
  const locale = ctx.locale;
  const { summary, groups } = groupSnapshotDiagnostics(data, locale);
  const lines: string[] = [`! ${summary}`];
  for (const group of groups) {
    lines.push(`! ${group.experimentId}`);
    for (const item of group.items) {
      const time = `${formatReportDateTime(item.startedAt, locale)} (↩ ${formatHistoricalGap(item.startedAt)})`;
      lines.push(`!   ${time}`);
      for (const record of item.diagnostics) {
        const n = occurrencesOf(record);
        lines.push(`!     ${record.level} · ${record.code}${n > 1 ? ` ×${n}` : ""}`);
        lines.push(`!       ${record.message}`);
        if (record.command !== undefined) lines.push(`!       → ${record.command}`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * TraceWaterfall 的 text 面:每 attempt 一行——locator、总耗时(缺 trace 如实显示缺失)、
 * 顶层 span 计数与失败标记,行尾是可复制的 `--timing` 下钻命令(经宿主注入的 attemptCommand
 * 通道拼出,携带宿主上下文)。当前报告没有 attempt-input page 时 `ctx.attemptCommand`
 * 不存在,行退化为纯文本,不生成假命令(architecture.md「Attempt 详情是一张参数化 page」)。
 */
export function traceWaterfallText(rows: readonly TraceWaterfallRow[], ctx: TextContext): string {
  const locale = ctx.locale;
  if (rows.length === 0) return localeText(locale, "traceWaterfall.empty");
  return rows
    .map((row) => {
      const failedSpans = row.spans.filter((span) => span.failed).length;
      const parts = [
        row.locator,
        row.evalId,
        row.durationMs === null ? localeText(locale, "traceWaterfall.noTrace") : formatDurationMs(row.durationMs),
        countText(locale, "traceWaterfall.spans", row.spans.length),
        ...(failedSpans > 0 ? [`✗ ${countText(locale, "traceWaterfall.failedSpans", failedSpans)}`] : []),
      ];
      const line = parts.join(" · ");
      return ctx.attemptCommand ? `${line}   ${ctx.attemptCommand(row.locator)} --timing` : line;
    })
    .join("\n");
}
