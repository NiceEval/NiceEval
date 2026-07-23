// unit 驱动的内置格式化(docs/feature/reports/library.md「指标」):
//   "%" → 87%    "ms" → 1.2s    "$" → $0.31    其余 → 1.2k 缩写(带 unit 后缀)
// metric.display 可整体覆盖;这里只负责默认。

import type { Verdict } from "../../types.ts";
import { gapParts } from "../../results/select.ts";
import { DISPLAY_LOCALES, type LocalizedText, type ReportLocale } from "./locale.ts";

/**
 * 一组 id 的显示名：每个 id 缩成在这组里唯一的最短路径后缀，重名逐步加长到能区分为止
 * （与 `MetricScatter` 点标签同一算法，两处共用本函数以保证同一份 experiment id 在散点和
 * 列表里缩成同一个显示名）。单个 id、或所有 id 深度不同时也照常缩到各自的最短唯一后缀。
 * 完整 id 不受影响，调用方仍用它做排序 / 过滤 / 折叠的身份键，这里只产出显示名。
 */
export function shortestUniqueLabels(ids: readonly string[]): Map<string, string> {
  const segsOf = (id: string) => id.split("/").filter(Boolean);
  const depth = new Map<string, number>(ids.map((id) => [id, 1]));
  for (;;) {
    const byLabel = new Map<string, string[]>();
    for (const id of ids) {
      const segs = segsOf(id);
      const label = segs.slice(-Math.min(depth.get(id)!, segs.length)).join("/") || id;
      byLabel.set(label, [...(byLabel.get(label) ?? []), id]);
    }
    let grew = false;
    for (const group of byLabel.values()) {
      if (group.length < 2) continue;
      for (const id of group) {
        const segs = segsOf(id);
        if (depth.get(id)! < segs.length) {
          depth.set(id, depth.get(id)! + 1);
          grew = true;
        }
      }
    }
    if (!grew) {
      const out = new Map<string, string>();
      for (const id of ids) {
        const segs = segsOf(id);
        out.set(id, segs.slice(-Math.min(depth.get(id)!, segs.length)).join("/") || id);
      }
      return out;
    }
  }
}

/** 一位小数、去掉无意义的 ".0" 尾巴。 */
function trimmed(n: number): string {
  const s = n.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** 1.2k / 3.4M / 5.6B 式缩写(输入为非负数)。 */
function abbreviate(abs: number): string {
  if (abs >= 1e9) return `${trimmed(abs / 1e9)}B`;
  if (abs >= 1e6) return `${trimmed(abs / 1e6)}M`;
  if (abs >= 1e3) return `${trimmed(abs / 1e3)}k`;
  return Number.isInteger(abs) ? String(abs) : trimmed(abs);
}

function formatDuration(absMs: number): string {
  if (absMs < 1000) return `${Math.round(absMs)}ms`;
  if (absMs < 60_000) return `${trimmed(absMs / 1000)}s`;
  const totalSeconds = Math.round(absMs / 1000);
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}

function formatDollars(abs: number): string {
  if (abs >= 1000) return abbreviate(abs);
  if (abs >= 0.01 || abs === 0) return abs.toFixed(2);
  // 小额成本保留有效位,不四舍成 "$0.00" 假零
  return abs.toFixed(4);
}

export function formatMetricValue(value: number, unit?: string): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (unit === "%") return `${sign}${trimmed(Math.round(abs * 1000) / 10)}%`;
  if (unit === "ms") return sign + formatDuration(abs);
  if (unit === "$") return `${sign}$${formatDollars(abs)}`;
  const n = abbreviate(abs);
  return unit ? `${sign}${n} ${unit}` : `${sign}${n}`;
}

/**
 * MetricCell.display 的生成:为官方生成面覆盖的每个 locale(DISPLAY_LOCALES)各生成一份;
 * 全部相同(内置 unit 格式化都是 locale 无关的)时折叠成单个字符串,renderer 按
 * LocalizedText 回退规则选择。`make` 抛错由调用方(computeCell)带 metric 上下文包装。
 */
export function localizedDisplay(make: (locale: ReportLocale) => string): LocalizedText {
  const entries = DISPLAY_LOCALES.map((locale) => [locale, make(locale)] as const);
  const first = entries[0]![1];
  if (entries.every(([, text]) => text === first)) return first;
  return Object.fromEntries(entries);
}

/** 无单位纯数字(scoreboard 总分等):一位小数,去尾零。 */
export function formatPlainNumber(value: number): string {
  const sign = value < 0 ? "-" : "";
  return sign + trimmed(Math.round(Math.abs(value) * 10) / 10);
}

/**
 * 计分制 attempt 详情里的挣分标注:`.points(n)` 挣到的分(`n × score`)或 `t.score(label, n)`
 * 的直接给分,单复数随数值(`+1 pt` / `+0.8 pts` / `+0 pts`)——挣 0 分同样显示,不隐藏
 * (docs/feature/scoring/library/display.md「计分制:.points 与给分记录」)。
 */
export function formatPointsSuffix(points: number): string {
  return `+${formatPlainNumber(points)} ${points === 1 ? "pt" : "pts"}`;
}

// ── 以下是两个渲染面共用的展示格式化:MetricCell 一律自带 display(格式化发生在
//    计算侧),渲染面不重算;这里只服务 OverviewData 这类携带裸数字的字段。──

/** 全 null / 无样本的统一文案。绝不画 0(docs/feature/reports/architecture.md「指标聚合不变量」)。 */
export const MISSING_TEXT = "no data";

/** 毫秒 → 人读耗时("850ms" / "1.2s" / "4m 20s" / "1h 4m")。 */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** 美元金额;小额保留更多位数,不四舍五入成 $0.00 的假零。 */
export function formatUSD(usd: number): string {
  if (usd === 0) return "$0";
  const digits = Math.abs(usd) >= 0.01 ? 2 : 4;
  return `$${usd.toFixed(digits)}`;
}

/** 0..1 的比率 → 整数百分比。 */
export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

type ReportDateTimeOptions = Intl.DateTimeFormatOptions;

function formatReportDate(date: Date, locale: ReportLocale, options: ReportDateTimeOptions): string {
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return new Intl.DateTimeFormat("en", options).format(date);
  }
}

const FULL_REPORT_DATE_TIME: ReportDateTimeOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
};

/** ISO 时间 → 本地化到分钟的短日期时间；不可解析时原样返回。 */
export function formatReportDateTime(iso: string, locale: ReportLocale): string {
  const date = new Date(iso);
  return Number.isNaN(date.valueOf()) ? iso : formatReportDate(date, locale, FULL_REPORT_DATE_TIME);
}

/** 时间范围的两端；同日省略右侧日期，同年省略右侧年份，减少卡片中的重复噪音。 */
export function formatReportDateTimeRange(
  fromIso: string,
  toIso: string,
  locale: ReportLocale,
): { from: string; to: string } {
  const fromDate = new Date(fromIso);
  const toDate = new Date(toIso);
  if (Number.isNaN(fromDate.valueOf()) || Number.isNaN(toDate.valueOf())) {
    return { from: formatReportDateTime(fromIso, locale), to: formatReportDateTime(toIso, locale) };
  }
  const sameYear = fromDate.getFullYear() === toDate.getFullYear();
  const sameDay =
    sameYear && fromDate.getMonth() === toDate.getMonth() && fromDate.getDate() === toDate.getDate();
  const toOptions: ReportDateTimeOptions = sameDay
    ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
    : {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        ...(!sameYear && { year: "numeric" }),
      };
  return {
    from: formatReportDate(fromDate, locale, FULL_REPORT_DATE_TIME),
    to: formatReportDate(toDate, locale, toOptions),
  };
}

// ── 实体列表(ExperimentList / EvalList / AttemptList)共用的时效标注 ──

/**
 * 历史执行的紧凑时距("3d" / "2h" / "5m" / "10s"):自 `startedAt` 起算,渲染时刻由调用方
 * 传入(`nowIso` 缺省当前时刻)——粒度阈值复用 `gapParts`(与曾经的 stale-snapshot message
 * 同一套单源,见 `results/select.ts`),只是这里的呈现是紧凑单字母,不是完整单词
 * (docs/feature/reports/library/entity-lists.md「时效标注」)。
 */
export function formatHistoricalGap(startedAtIso: string, nowIso: string = new Date().toISOString()): string {
  const { n, unit } = gapParts(startedAtIso, nowIso);
  return `${n}${unit[0]}`;
}

// ── 实体列表(ExperimentList / EvalList / AttemptList)共用的判定符 ──

/** passed / failed / errored / skipped 的判定符。 */
export function verdictMark(verdict: Verdict): string {
  switch (verdict) {
    case "passed":
      return "✓";
    case "failed":
      return "✗";
    case "errored":
      return "!";
    case "skipped":
      return "–";
  }
}

/**
 * `AttemptListItem.failureSummary` 的宽度收口:摘要已在计算侧按 Scoring display 契约折好,
 * 渲染面只做尾截,不重算摘要。maxChars 是渲染面的宽度预算(如两行单元格 = 2 × 列宽)。
 */
export function fitFailureSummary(summary: string, maxChars: number): string {
  return summary.length <= maxChars ? summary : `${summary.slice(0, Math.max(0, maxChars - 1))}…`;
}

// ── ExperimentList(web ExperimentList.tsx / text faces.ts)共用的题型构成判据 ──

/**
 * 一份 `ExperimentList` data 的题型构成:主读数列该显示 Pass rate、Total score,还是两者
 * 并存(docs/feature/reports/library/entity-lists.md「ExperimentList」主读数列)。与
 * `entity-lists/compute.ts` 里 `experimentListData` 默认排序专用的 `listScoringComposition`
 * 同一套判据——跳过 `attempts === 0` 的行(coverage-only 占位,`scoring` 是占位默认值不是
 * 读到的事实,一屏占位行不该把纯计分制列表误判成 mixed)。web 面与 text 面在这里读同一份
 * 判据,不各自重新判断,列集合与 `experimentListData` 已经算好的默认排序永远对得上。
 */
export function experimentListScoringComposition(
  items: readonly { scoring: "pass" | "points"; attempts: number }[],
): "pass" | "points" | "mixed" {
  let hasPass = false;
  let hasPoints = false;
  for (const item of items) {
    if (item.attempts === 0) continue;
    if (item.scoring === "points") hasPoints = true;
    else hasPass = true;
  }
  if (hasPass && hasPoints) return "mixed";
  return hasPoints ? "points" : "pass";
}
