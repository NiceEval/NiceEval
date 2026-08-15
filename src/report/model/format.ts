// unit 驱动的内置格式化(docs/feature/reports/library.md):
//   "%" → 87%    "ms" → 1.2s    "$" → $0.31    其余 → 1.2k 缩写(带 unit 后缀)
// MetricValue.format 可覆盖；公开入口是 formatMetricValue / formatAxisTick。
// 输入是当前 Analysis 关闭的完整 MetricValue(value 可以为 null,state/samples/total
// 原样保留);这里只格式化显示字节,不重新统计、不把 null 猜成零。

import type { Verdict } from "../../types.ts";
import type { AnalysisIssue, EvidenceRef, MeasureFormat, MetricValue } from "../../analysis/index.ts";
import {
  DEFAULT_REPORT_LOCALE,
  DISPLAY_LOCALES,
  localeText,
  type LocalizedText,
  type ReportLocale,
} from "./locale.ts";

/** v0.12 的显示覆盖词表;当前 MeasureFormat 的 kind 字符串经 `resolveFormatUnit` 落到同一支。 */
export type MetricFormat =
  | "number"
  | "percent"
  | "duration"
  | "currency"
  | { readonly kind: "custom"; readonly format: (value: number, locale: string) => string };

/** 内部 AttemptMetric 显示覆盖：只格式化同一个终值，不改变口径。 */
export type MetricDisplay = (value: number, locale: ReportLocale) => string;

/**
 * 一套 id 的显示名：每个 id 缩成在这组里唯一的最短路径后缀，重名逐步加长到能区分为止
 * （与 `Scatter` 点标签同一算法，两处共用本函数以保证同一份 experiment id 在散点和
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

/**
 * 按 unit 折一个终值。unit 是量纲声明,也是格式化的唯一开关
 * (docs/feature/reports/library.md「unit 决定格式」)。
 */
function formatNumberWithUnit(value: number, unit?: string): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (unit === "%") return `${sign}${trimmed(Math.round(abs * 1000) / 10)}%`;
  if (unit === "ms") return sign + formatDuration(abs);
  if (unit === "$") return `${sign}$${formatDollars(abs)}`;
  const n = abbreviate(abs);
  return unit ? `${sign}${n} ${unit}` : `${sign}${n}`;
}

/**
 * 当前 Analysis 的 MeasureFormat kind 词表 → v0.12 的 unit 开关。未知 kind 不映射,
 * 回落声明 unit;两级都没有时按无单位读数格式化。词表只做显示适配,不新建统计口径。
 */
function resolveFormatUnit(format: MeasureFormat | undefined, unit?: string): string | undefined {
  if (typeof format !== "string") return unit;
  switch (format) {
    case "percent":
    case "ratio":
      return "%";
    case "usd":
    case "currency":
    case "currency-usd":
      return "$";
    case "duration":
    case "duration-ms":
    case "milliseconds":
      return "ms";
    case "number":
    case "count":
    case "integer":
      return undefined;
    default:
      return unit;
  }
}

/**
 * 在 renderer 内按当前 locale 格式化一个 MetricValue 终值。
 * 结果不写回 MetricValue；text/web 两面各自调用同一函数。
 * `format` 同时接受 v0.12 的显示词表与当前 MeasureFormat kind 字符串。
 *
 * 兼容段(临时):当前 `src/report/index.ts` facade 还会以 `(metric, locale)` 形态调用;
 * Q.X 重写公共出口、H 删除 classic 后,这个对象重载随兼容段一并删除。
 */
export function formatMetricValue(metric: MetricValue, locale?: ReportLocale): string;
export function formatMetricValue(
  value: number | null,
  unit?: string,
  format?: MetricFormat | MeasureFormat,
  locale?: ReportLocale,
): string;
export function formatMetricValue(
  value: number | null | MetricValue,
  unitOrLocale?: string | ReportLocale,
  format?: MetricFormat | MeasureFormat,
  locale?: ReportLocale,
): string {
  if (typeof value === "object" && value !== null) {
    const metric = value as MetricValue;
    const loc = (unitOrLocale as ReportLocale | undefined) ?? DEFAULT_REPORT_LOCALE;
    const display =
      metric.value === null
        ? missingText("noSamples", loc)
        : formatMetricValue(metric.value, metric.unit, metric.format, loc);
    return `${display} · ${metric.samples} / ${metric.total} ${metric.basis} · ${metric.state}`;
  }
  const metricValue = value as number | null;
  if (metricValue === null) return missingText("noSamples", locale);
  const unit = unitOrLocale as string | undefined;
  if (format && typeof format === "object" && format.kind === "custom") {
    const custom = format as { readonly format: (value: number, locale: string) => string };
    return custom.format(metricValue, locale ?? DEFAULT_REPORT_LOCALE);
  }
  if (typeof format === "string") {
    if (format === "percent") return formatNumberWithUnit(metricValue, "%");
    if (format === "currency") return formatNumberWithUnit(metricValue, "$");
    if (format === "duration") return formatNumberWithUnit(metricValue, "ms");
  }
  const resolvedUnit = resolveFormatUnit(format as MeasureFormat | undefined, unit);
  return formatNumberWithUnit(metricValue, resolvedUnit);
}

/**
 * 轴刻度标签:精度按刻度步长自适应。契约(metric-views.md「图轴值域」)要求「标签始终显示
 * 真实值」——极小量程(如成本 ~0.0001)下固定小数位会把相邻刻度折叠成同一个字符串,
 * 读者据此无法区分刻度。步长已知时取恰好能区分相邻刻度的小数位(整齐刻度是 1/2/5×10^k,
 * toFixed(⌈-log10(step)⌉) 恒精确),再裁掉尾零;步长不可用(单刻度)回退通用格式化。
 */
export function formatAxisTick(value: number, step: number, unit?: string): string {
  if (!(step > 0) || !Number.isFinite(step)) return formatNumberWithUnit(value, unit);
  // 精度 = 步长自身的十进制小数位数(nice 步长是 1/2/2.5/5×10^k,如 0.25 需要 2 位,不是 ⌈-log10⌉ 的 1 位)。
  let decimals = 0;
  while (decimals < 10 && Math.abs(Math.round(step * 10 ** decimals) - step * 10 ** decimals) > 1e-9 * 10 ** decimals) decimals++;
  if (decimals === 0) return formatNumberWithUnit(value, unit);
  // 精确到步长的定点展示,去尾零——整齐刻度是 1/2/5×10^k,toFixed(⌈-log10(step)⌉) 恒无损。
  const fixed = (n: number, d: number) => n.toFixed(d).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (unit === "%") return `${sign}${fixed(abs * 100, Math.max(0, decimals - 2))}%`;
  if (unit === "ms") return formatNumberWithUnit(value, unit);
  if (unit === "$") return `${sign}$${fixed(abs, decimals)}`;
  return unit ? `${sign}${fixed(abs, decimals)} ${unit}` : `${sign}${fixed(abs, decimals)}`;
}

/**
 * 内部旧切片把格式化结果投影进 Content 时使用；公共 MetricValue 不携带 display。
 */
export function metricDisplay(
  value: number | null,
  unit?: string,
  override?: MetricDisplay,
): LocalizedText {
  if (value === null) {
    return localizedDisplay((locale) => localeText(locale, "cell.missing"));
  }
  if (override) {
    return localizedDisplay((locale) => override(value, locale));
  }
  return formatMetricValue(value, unit);
}

/** missing 格内建 code → locale 词典 key。词表未命中时 missingText 原样返回 code。 */
const MISSING_CODE_KEYS = {
  noSamples: "cell.missing",
  unscorable: "cell.unscorable",
  noCurrentResult: "cell.noCurrentResult",
} as const;

/**
 * `missing` 格的本地化原因。code 是结构化代码,不是显示文本
 * (docs/feature/reports/library.md「缺数据、不适用与占位」)。
 * 无参调用是兼容段(临时):旧 facade 的 missingText() 恒返回统一显示符,随 Q.X/H 删除。
 */
export function missingText(code?: string, locale: ReportLocale = DEFAULT_REPORT_LOCALE): string {
  if (code === undefined) return "—";
  const key = MISSING_CODE_KEYS[code as keyof typeof MISSING_CODE_KEYS];
  return key ? localeText(locale, key) : code;
}

/** 内部旧切片生成 LocalizedText；公共 MetricValue 不走这条路径。 */
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
 * (docs/feature/assertions/library/display.md「计分制:.points 与给分记录」)。这是某一条检查/
 * 记录的**增量**标注,带前导 `+`;attempt 头行的总分位用 `formatPoints`(绝对值,不带 `+`)。
 */
export function formatPointsSuffix(points: number): string {
  return `+${formatPlainNumber(points)} ${points === 1 ? "pt" : "pts"}`;
}

/**
 * attempt 头行总分位的绝对值展示("1 pt" / "4 pts",不带 `+`)——这是这一轮挣到的总分本身,
 * 不是某条检查的增量(那个用 `formatPointsSuffix` 的 "+N pts"),见
 * docs/feature/reports/cli.md 计分制示例头行。
 */
export function formatPoints(points: number): string {
  return `${formatPlainNumber(points)} ${points === 1 ? "pt" : "pts"}`;
}

// ── 以下是旧切片 Content 的内部展示辅助；公共 MetricValue 由 renderer 调
//    formatMetricValue，不携带预生成 display。──

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

/**
 * ISO 时刻 → 当前 locale 的人读时间(到分钟);不可解析时原样返回。
 *
 * 时刻不是 `MetricValue`——没有量纲、不参与聚合、不上轴——所以它不走 `unit` 那条开关,
 * 这里是它唯一的入口(docs/feature/reports/library.md「时刻不走 unit」)。
 */
export function formatInstant(iso: string, locale: ReportLocale = DEFAULT_REPORT_LOCALE): string {
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
    return { from: formatInstant(fromIso, locale), to: formatInstant(toIso, locale) };
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

// ── 相对时距 ──

/** 时距词表按区间取的单位;`{n}` 插值,en 是紧凑后缀,zh-CN 带空格接量词。 */
const TIME_DISTANCE_KEYS = {
  minute: "timeDistance.minute",
  hour: "timeDistance.hour",
  day: "timeDistance.day",
  month: "timeDistance.month",
} as const;

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const MS_PER_MONTH = MS_PER_DAY * 30;

/**
 * 一段时长(毫秒) → 当前 locale 的紧凑相对时距("12d" / "12 天")。按区间选粒度最大的单位
 * 取整,结果恒不小于一个单位(docs/feature/reports/library.md「相对时距是数据,
 * 不是文案」):不足 1 小时→分钟,不足 1 天→小时,不足 30 天→天,30 天及以上→月。
 * 这个 formatter 只处理时长显示，不判断一条结果是否仍适用于当前选择。
 */
export function formatTimeDistance(ms: number, locale: ReportLocale = DEFAULT_REPORT_LOCALE): string {
  const abs = Math.max(0, ms);
  if (abs < MS_PER_HOUR) {
    return localeText(locale, TIME_DISTANCE_KEYS.minute, { n: Math.max(1, Math.round(abs / MS_PER_MINUTE)) });
  }
  if (abs < MS_PER_DAY) {
    return localeText(locale, TIME_DISTANCE_KEYS.hour, { n: Math.max(1, Math.round(abs / MS_PER_HOUR)) });
  }
  if (abs < MS_PER_MONTH) {
    return localeText(locale, TIME_DISTANCE_KEYS.day, { n: Math.max(1, Math.round(abs / MS_PER_DAY)) });
  }
  return localeText(locale, TIME_DISTANCE_KEYS.month, { n: Math.max(1, Math.round(abs / MS_PER_MONTH)) });
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
 * `AttemptListItem.failureSummary` 的宽度收口:摘要已在计算侧按断言摘要契约折好,
 * 渲染面只做尾截,不重算摘要。maxChars 是渲染面的宽度预算(如两行单元格 = 2 × 列宽)。
 */
export function fitFailureSummary(summary: string, maxChars: number): string {
  return summary.length <= maxChars ? summary : `${summary.slice(0, Math.max(0, maxChars - 1))}…`;
}

// ── ExperimentList(web ExperimentList.tsx / text faces.ts)共用的题型构成判据 ──

/**
 * 题型构成:v0.12 的 model/types.ts 定义,当前 Analysis facade 尚未落盘时先住在这里,
 * B 的 model/types.ts 落定后可直接 re-export,调用方不改拼写。
 */
export type EvaluationKindComposition = "pass" | "points" | "mixed";

/**
 * 一份 `ExperimentList` data 的题型构成:主读数列该显示 Pass rate、Total score,还是两者
 * 并存(docs/feature/reports/library.md 主读数列)。与
 * `entity-lists/compute.ts` 里 `experimentListData` 默认排序专用的 `listEvaluationKindComposition`
 * 同一套判据——跳过 `attempts === 0` 的行(coverage-only 占位,`evaluationKind` 是占位默认值不是
 * 读到的事实,一屏占位行不该把纯计分制列表误判成 mixed)。web 面与 text 面在这里读同一份
 * 判据,不各自重新判断,列集合与 `experimentListData` 已经算好的默认排序永远对得上。
 */
export function experimentListEvaluationKindComposition(
  items: readonly { evaluationKind: EvaluationKindComposition; attempts: number }[],
): EvaluationKindComposition {
  let hasPass = false;
  let hasPoints = false;
  for (const item of items) {
    if (item.attempts === 0) continue;
    if (item.evaluationKind !== "pass") hasPoints = true;
    if (item.evaluationKind !== "points") hasPass = true;
  }
  if (hasPass && hasPoints) return "mixed";
  return hasPoints ? "points" : "pass";
}

// ── 兼容段(临时):当前 src/report/index.ts facade 的名字 ──
// 这些导出只服务尚未切换的旧公共出口;实现全部委托上面的 v0.12 格式化函数,
// 不构成第二套 formatter。Q.X 重写 index.ts / H 删除 classic 时整段删除。

/** 旧 facade 的完整读数投影形状。 */
export interface MetricPresentation {
  readonly metric: MetricValue;
  readonly value: string;
  readonly coverage: string;
  readonly state: MetricValue["state"];
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
  readonly text: string;
}

/** 旧 facade:把显示值与完整度、状态事实并列投影,不动 MetricValue 本体。 */
export function presentMetric(
  metric: MetricValue,
  locale: ReportLocale = DEFAULT_REPORT_LOCALE,
): MetricPresentation {
  const value =
    metric.value === null ? missingText("noSamples", locale) : formatMetricValue(metric.value, metric.unit, metric.format, locale);
  return Object.freeze({
    metric,
    value,
    coverage: `${metric.samples} / ${metric.total} ${metric.basis}`,
    state: metric.state,
    issues: metric.issues,
    refs: metric.refs,
    text: formatMetricValue(metric, locale),
  });
}

/** 旧 facade:按 Analysis format 词汇格式化裸数(委托 v0.12 的 unit 开关)。 */
export function formatMetricNumber(
  value: number,
  format: MeasureFormat | undefined,
  locale: ReportLocale = DEFAULT_REPORT_LOCALE,
): string {
  return formatMetricValue(value, undefined, format, locale);
}

/** 旧 facade:本地化文本的直接解析,缺失时按 en → 首值 → 空串回退。 */
export function formatLocalizedText(value: LocalizedText, locale: ReportLocale = DEFAULT_REPORT_LOCALE): string {
  if (typeof value === "string") return value;
  const exact = value[locale];
  return exact ?? value.en ?? Object.values(value)[0] ?? "";
}
