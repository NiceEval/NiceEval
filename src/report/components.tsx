// 官方双面组件的装配点:web 面(./react/ 的纯 React 组件)+ text 面(./text/faces.ts)
// + resolve 解析面(spec 形态由管线代调配套 *Data 函数)。faces 两键必填 —— 配对是结构
// 义务;MetricBars 与 MetricMatrix 消费同一份矩阵数据(同一个 metricMatrixData)。
//
// props 双形态以 `data` 判别(docs/feature/reports/library/metric-views.md):
//   spec 形态 = 计算选项平铺 + 可选 `input`(默认宿主注入的 Scope),管线在 resolve 阶段
//   代调同名 *Data,与手工计算严格等价;data 形态接收算好的可序列化数据,跳过取数。
//   同一组件同时给出 `data` 与 spec 字段按完整用户反馈报错,不静默取一边。
// 组件消费 `data` 时校验结构,不符合当前形状按完整用户反馈报错并提示可能的版本漂移。
//
// 官方组件在宿主里自动接上证据室:web 面的 attemptHref 缺省取 ctx.attemptHref
// (宿主注入的证据室深链,当前 definition 没有 attempt-input page 时不存在);
// 显式传 prop 可覆盖(嵌进自己应用时自定去处)。

import type { ReactNode } from "react";
import {
  defineComponent,
  memoFetchOf,
  type ReportComponent,
  type ResolveContext,
  type TextContext,
  type WebContext,
} from "./tree.ts";
import type { LocalizedText, ReportLocale } from "./locale.ts";
import type { AttemptLocator } from "../results/locator.ts";
import type {
  AttemptListItem,
  CopyFixPromptData,
  DeltaData,
  EvalListItem,
  ExperimentComparisonData,
  ExperimentListItem,
  HeroData,
  LineData,
  MatrixData,
  ReportInput,
  ScatterData,
  ScopeSummaryData,
  ScopeWarning,
  ScoreboardData,
  TableData,
  TraceWaterfallRow,
} from "./types.ts";
import {
  attemptListData,
  copyFixPromptData,
  deltaTableData,
  evalListData,
  experimentComparisonData,
  experimentListData,
  heroData,
  metricLineData,
  metricMatrixData,
  metricScatterData,
  metricTableData,
  scopeSummaryData,
  scopeWarningsData,
  scoreboardData,
  traceWaterfallData,
  type DeltaTableOptions,
  type MetricLineOptions,
  type MetricMatrixOptions,
  type ExperimentComparisonOptions,
  type MetricScatterOptions,
  type MetricTableOptions,
  type ScoreboardOptions,
} from "./compute.ts";
import { collectItems, locatorOf, resolveInput } from "./aggregate.ts";
import {
  attemptListText,
  deltaText,
  evalListText,
  experimentComparisonText,
  experimentListText,
  barsText,
  heroCardText,
  lineText,
  matrixText,
  scatterText,
  scopeWarningsText,
  scoreboardText,
  scopeSummaryText,
  tableText,
  traceWaterfallText,
} from "./text/faces.ts";
import { ScopeSummary as ScopeSummaryWeb } from "./react/ScopeSummary.tsx";
import { ExperimentComparisonView } from "./react/ExperimentComparison.tsx";
import { ExperimentList as ExperimentListWeb } from "./react/ExperimentList.tsx";
import { EvalList as EvalListWeb } from "./react/EvalList.tsx";
import { AttemptList as AttemptListWeb } from "./react/AttemptList.tsx";
import { HeroCard as HeroCardWeb } from "./react/HeroCard.tsx";
import { PoweredBy as PoweredByWeb } from "./react/PoweredBy.tsx";
import { ScopeWarnings as ScopeWarningsWeb } from "./react/ScopeWarnings.tsx";
import { CopyFixPrompt as CopyFixPromptWeb } from "./react/CopyFixPrompt.tsx";
import { TraceWaterfall as TraceWaterfallWeb } from "./react/TraceWaterfall.tsx";
import { MetricTable as MetricTableWeb } from "./react/MetricTable.tsx";
import { MetricMatrix as MetricMatrixWeb } from "./react/MetricMatrix.tsx";
import { MetricBars as MetricBarsWeb } from "./react/MetricBars.tsx";
import { Scoreboard as ScoreboardWeb } from "./react/Scoreboard.tsx";
import { MetricScatter as MetricScatterWeb } from "./react/MetricScatter.tsx";
import { MetricLine as MetricLineWeb } from "./react/MetricLine.tsx";
import { DeltaTable as DeltaTableWeb } from "./react/DeltaTable.tsx";

// ───────────────────────── DataProps 组合规则 ─────────────────────────

type Never<T> = { [K in keyof T]?: never };

/**
 * 官方数据组件的统一 props 组合(docs/feature/reports/library/metric-views.md):
 * data 形态(接收配套 *Data 的产物)或 spec 形态(Options 平铺 + 可选 input)。
 */
export type DataProps<Data, Options, Presentation> =
  | ({ data: Data; input?: never } & Never<Options> & Presentation)
  | ({ data?: never; input?: ReportInput } & Options & Presentation);

// ───────────────────────── data 结构校验(版本漂移防线)─────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCell(value: unknown): boolean {
  return (
    isObject(value) &&
    "value" in value &&
    "display" in value &&
    typeof value.samples === "number" &&
    typeof value.total === "number" &&
    Array.isArray(value.refs)
  );
}

function isTally(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.passed === "number" &&
    typeof value.failed === "number" &&
    typeof value.errored === "number" &&
    typeof value.skipped === "number"
  );
}

type Validator = (data: unknown) => string | null;

function dataShapeError(component: string, dataFnName: string, shape: string, problem: string): Error {
  return new Error(
    `<${component}> received data that does not match the current ${shape} shape: ${problem}. ` +
      `It may have been computed by a different niceeval version (component data carries no schemaVersion; the support window is same-version write and read). ` +
      `Recompute it with ${dataFnName}() from this niceeval version, then re-render.`,
  );
}

const validateTableData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (typeof data.rowDimension !== "string") return 'missing "rowDimension" (string)';
  if (!Array.isArray(data.columns)) return 'missing "columns" (array)';
  if (!Array.isArray(data.rows)) return 'missing "rows" (array)';
  for (const row of data.rows as unknown[]) {
    if (!isObject(row) || typeof row.key !== "string" || !isObject(row.cells)) {
      return 'each row needs { key, cells }';
    }
  }
  return null;
};

const validateMatrixData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (typeof data.rowDimension !== "string" || typeof data.columnDimension !== "string") {
    return 'missing "rowDimension" / "columnDimension" (string)';
  }
  if (!isObject(data.metric)) return 'missing "metric" (MetricColumn)';
  if (!Array.isArray(data.cells)) return 'missing "cells" (array)';
  return null;
};

const validateScatterData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (typeof data.pointDimension !== "string") return 'missing "pointDimension" (string)';
  if (!isObject(data.x) || !isObject(data.y)) return 'missing "x" / "y" (MetricColumn)';
  if (!Array.isArray(data.rows)) return 'missing "rows" (array)';
  for (const row of data.rows as unknown[]) {
    if (!isObject(row) || typeof row.key !== "string" || !isCell(row.x) || !isCell(row.y)) {
      return "each row needs { key, x: MetricCell, y: MetricCell }";
    }
  }
  return null;
};

const validateLineData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (!isObject(data.x) || typeof (data.x as Record<string, unknown>).key !== "string") return 'missing "x" axis descriptor';
  if (!isObject(data.y)) return 'missing "y" (MetricColumn)';
  if (!Array.isArray(data.rows)) return 'missing "rows" (array)';
  return null;
};

const validateScoreboardData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (typeof data.rowDimension !== "string") return 'missing "rowDimension" (string)';
  if (!Array.isArray(data.questions)) return 'missing "questions" (array)';
  if (typeof data.fullMarks !== "number") return 'missing "fullMarks" (number)';
  if (typeof data.ignoredEvals !== "number") return 'missing "ignoredEvals" (number)';
  if (!Array.isArray(data.rows)) return 'missing "rows" (array)';
  for (const row of data.rows as unknown[]) {
    if (!isObject(row) || !isObject(row.total) || typeof (row.total as Record<string, unknown>).notRun !== "number") {
      return 'each row needs { key, total: { value, display, notRun, unscorable, refs }, subjects }';
    }
  }
  return null;
};

const validateDeltaData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (typeof data.byDimension !== "string") return 'missing "byDimension" (string)';
  if (!Array.isArray(data.columns) || !Array.isArray(data.rows)) return 'missing "columns" / "rows" (array)';
  for (const row of data.rows as unknown[]) {
    if (!isObject(row) || row.label === undefined || !isObject(row.a) || !isObject(row.b)) {
      return "each row needs { key, label, a, b, cells }";
    }
  }
  return null;
};

const validateScopeSummaryData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (!isObject(data.range)) return 'missing "range" ({ earliestStartedAt, latestStartedAt })';
  if (!isTally(data.evalVerdicts) || !isTally(data.attemptVerdicts)) {
    return 'missing "evalVerdicts" / "attemptVerdicts" tallies';
  }
  if (!isCell(data.endToEndPassRate) || !isCell(data.totalCostUSD)) {
    return 'missing "endToEndPassRate" / "totalCostUSD" (MetricCell)';
  }
  return null;
};

const validateComparisonData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (validateScopeSummaryData(data.summary) !== null) return 'missing "summary" (ScopeSummaryData)';
  if (!isObject(data.scatter) || !Array.isArray((data.scatter as Record<string, unknown>).rows)) {
    return 'missing "scatter" (ScatterData)';
  }
  if (!Array.isArray(data.experiments)) return 'missing "experiments" (array)';
  return null;
};

const validateExperimentListData: Validator = (data) => {
  if (!Array.isArray(data)) return "expected an array of ExperimentListItem";
  for (const item of data as unknown[]) {
    if (!isObject(item) || typeof item.experimentId !== "string" || !isTally(item.evalVerdicts) || !isCell(item.endToEndPassRate)) {
      return "each item needs { experimentId, evalVerdicts, endToEndPassRate, costUSD, durationMs, tokens, evalRows, … }";
    }
  }
  return null;
};

const validateEvalListData: Validator = (data) => {
  if (!Array.isArray(data)) return "expected an array of EvalListItem";
  for (const item of data as unknown[]) {
    if (!isObject(item) || typeof item.evalId !== "string" || !isCell(item.examScore) || !Array.isArray(item.attempts)) {
      return "each item needs { experimentId, evalId, verdict, examScore, durationMs, costUSD, attempts }";
    }
  }
  return null;
};

const validateAttemptListData: Validator = (data) => {
  if (!Array.isArray(data)) return "expected an array of AttemptListItem";
  for (const item of data as unknown[]) {
    if (!isObject(item) || typeof item.evalId !== "string" || !("failureSummary" in item) || !("costUSD" in item)) {
      return "each item needs { experimentId, evalId, verdict, failureSummary, moreFailures, examScore, durationMs, costUSD, locator }";
    }
  }
  return null;
};

const validateHeroData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (!("latestStartedAt" in data) || (data.latestStartedAt !== null && typeof data.latestStartedAt !== "string")) {
    return 'missing "latestStartedAt" (string | null)';
  }
  if (typeof data.snapshots !== "number") return 'missing "snapshots" (number)';
  return null;
};

const validateScopeWarningsData: Validator = (data) => {
  if (!Array.isArray(data)) return "expected an array of ScopeWarning";
  for (const item of data as unknown[]) {
    if (!isObject(item) || typeof item.kind !== "string" || typeof item.message !== "string") {
      return "each warning needs { kind, message, … }";
    }
  }
  return null;
};

const validateCopyFixPromptData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (typeof data.prompt !== "string") return 'missing "prompt" (string)';
  if (typeof data.failures !== "number") return 'missing "failures" (number)';
  return null;
};

const validateTraceWaterfallData: Validator = (data) => {
  if (!Array.isArray(data)) return "expected an array of TraceWaterfallRow";
  for (const row of data as unknown[]) {
    if (
      !isObject(row) ||
      typeof row.experimentId !== "string" ||
      typeof row.evalId !== "string" ||
      typeof row.locator !== "string" ||
      !("durationMs" in row) ||
      (row.durationMs !== null && typeof row.durationMs !== "number") ||
      !Array.isArray(row.spans)
    ) {
      return "each row needs { experimentId, evalId, locator, durationMs: number | null, spans }";
    }
    for (const span of row.spans as unknown[]) {
      if (!isObject(span) || typeof span.name !== "string" || typeof span.startOffsetMs !== "number") {
        return "each span needs { name, kind, startOffsetMs, durationMs, failed }";
      }
    }
  }
  return null;
};

// ───────────────────────── spec / data 双形态的通用装配 ─────────────────────────

interface DataComponentDef<Data, Options, Presentation> {
  name: string;
  dataFnName: string;
  shapeName: string;
  dataFn: (input: ReportInput, options: Options) => Promise<Data>;
  /** spec 形态的计算选项 prop 名(不含 input);未列出的 props 视为呈现选项原样保留。 */
  specKeys: readonly string[];
  validate: Validator;
  web(props: { data: Data } & Presentation, ctx: WebContext): ReactNode;
  text(props: { data: Data } & Presentation, ctx: TextContext): string;
}

function makeDataComponent<Data, Options, Presentation>(
  def: DataComponentDef<Data, Options, Presentation>,
): ReportComponent<DataProps<Data, Options, Presentation>> {
  type Props = Record<string, unknown>;
  type Resolved = { data: Data } & Presentation;

  const assertData = (data: unknown): Data => {
    const problem = def.validate(data);
    if (problem !== null) throw dataShapeError(def.name, def.dataFnName, def.shapeName, problem);
    return data as Data;
  };

  const resolve = async (props: Props, ctx: ResolveContext): Promise<Resolved> => {
    const givenSpec = def.specKeys.filter((key) => props[key] !== undefined);
    if (props.data !== undefined) {
      if (givenSpec.length > 0 || props.input !== undefined) {
        const extras = [...givenSpec, ...(props.input !== undefined ? ["input"] : [])];
        throw new Error(
          `<${def.name}> got both \`data\` and spec field${extras.length > 1 ? "s" : ""} (${extras.join(", ")}) — the two data sources are exclusive and niceeval will not silently pick one. ` +
            `Keep \`data\` (precomputed with ${def.dataFnName}()) and drop the spec fields, or drop \`data\` and let the pipeline compute from the spec.`,
        );
      }
      assertData(props.data);
      return props as unknown as Resolved;
    }
    const options: Record<string, unknown> = {};
    for (const key of givenSpec) options[key] = props[key];
    const input = (props.input as ReportInput | undefined) ?? ctx.input;
    const data = await memoFetchOf(ctx)(def.dataFn, input, options, () =>
      def.dataFn(input, options as Options),
    );
    const rest: Record<string, unknown> = { ...props };
    delete rest.input;
    for (const key of def.specKeys) delete rest[key];
    return { ...rest, data } as unknown as Resolved;
  };

  const component = defineComponent<Props, Resolved>({
    resolve,
    web: (props, ctx) => {
      assertData((props as { data?: unknown }).data);
      return def.web(props, ctx);
    },
    text: (props, ctx) => {
      assertData((props as { data?: unknown }).data);
      return def.text(props, ctx);
    },
  }) as unknown as ReportComponent<DataProps<Data, Options, Presentation>>;
  component.displayName = def.name;
  return component;
}

/**
 * 缺省接证据室,显式 prop 覆盖。`ctx.attemptHref` 本身已经是「有没有」的完整信号——
 * 宿主外直接渲染、或宿主内但当前 definition 没有 attempt-input page 时它就是 undefined,
 * 不需要再判断是否在宿主里。
 */
function hrefOf(
  props: { attemptHref?: (locator: AttemptLocator) => string },
  ctx: WebContext,
): ((locator: AttemptLocator) => string) | undefined {
  return props.attemptHref ?? ctx.attemptHref;
}

// ───────────────────────── 呈现选项类型 ─────────────────────────

interface ChromeProps {
  /** chrome 文案 locale;省略时随宿主上下文(宿主外默认 "en")。 */
  locale?: ReportLocale;
  className?: string;
}

// ───────────────────────── 概览组件 ─────────────────────────

export type ScopeSummaryProps = DataProps<
  ScopeSummaryData,
  Record<never, never>,
  ChromeProps & {
    /** 显示哪一级计票;默认 "eval"。data 恒携带两级,votes 只选择呈现。 */
    votes?: "eval" | "attempt";
  }
>;

/** 范围摘要卡:时间窗、数量、两级计票、端到端通过率与总成本。 */
export const ScopeSummary = makeDataComponent<
  ScopeSummaryData,
  Record<never, never>,
  ChromeProps & { votes?: "eval" | "attempt" }
>({
  name: "ScopeSummary",
  dataFnName: "scopeSummaryData",
  shapeName: "ScopeSummaryData",
  dataFn: (input) => scopeSummaryData(input),
  specKeys: [],
  validate: validateScopeSummaryData,
  web: (props, ctx) => <ScopeSummaryWeb {...props} locale={props.locale ?? ctx.locale} />,
  text: (props, ctx) => scopeSummaryText(props.data, props.votes ?? "eval", ctx),
}) as unknown as ReportComponent<ScopeSummaryProps>;

type ComparisonChrome = ChromeProps & {
  /** 透传给散点;契约同 MetricScatter 的 connect。缺省时 series 维度为 "line" 时连线。 */
  connect?: boolean;
};

export type ExperimentComparisonProps = DataProps<ExperimentComparisonData, ExperimentComparisonOptions, ComparisonChrome>;

/**
 * 内建报告的默认组合件:对完整 input 计算一份 ScopeSummary、成本 × 端到端通过率散点和
 * ExperimentList——不同深度目录的 experiments 一律同屏,不分组、不生成 tab 或 panel 索引。
 * web/text 两面都直接显示完整 Scope。series 缺省解析(Scope 内有 label `line` 声明 →
 * 按线归类并连线,否则 agent、不连线)。
 */
export const ExperimentComparison = makeDataComponent<ExperimentComparisonData, ExperimentComparisonOptions, ComparisonChrome>({
  name: "ExperimentComparison",
  dataFnName: "experimentComparisonData",
  shapeName: "ExperimentComparisonData",
  dataFn: (input, options) => experimentComparisonData(input, options),
  specKeys: ["series"],
  validate: validateComparisonData,
  web: (props, ctx) => (
    <ExperimentComparisonView
      data={props.data}
      connect={props.connect}
      locale={props.locale ?? ctx.locale}
      className={props.className}
      attemptHref={ctx.attemptHref}
    />
  ),
  text: (props, ctx) => experimentComparisonText(props.data, props.className, ctx, props.connect),
}) as unknown as ReportComponent<ExperimentComparisonProps>;

// ───────────────────────── 实体列表 ─────────────────────────

interface EntityListChrome extends ChromeProps {
  attemptHref?: (locator: AttemptLocator) => string;
}

export type ExperimentListProps = DataProps<
  readonly ExperimentListItem[],
  Record<never, never>,
  EntityListChrome & {
    /** web 面在比较表前显示实验过滤框;text 面忽略。 */
    filter?: boolean;
    /**
     * 可选父路径:两面的行标签去掉与它相同的前缀,只显示 experiment id 末段。自定义报告
     * 显式传入使用;默认 `ExperimentComparison` 不传,完整 id 始终可见。完整 id 仍是
     * 排序 / 着色 / 过滤 / 折叠的键。
     */
    relativeTo?: string;
  }
>;

/** 实验列表:每项一个 experiment,固定八列比较表 + 展开到 Eval / Attempt。 */
export const ExperimentList = makeDataComponent<
  readonly ExperimentListItem[],
  Record<never, never>,
  EntityListChrome & { filter?: boolean; relativeTo?: string }
>({
  name: "ExperimentList",
  dataFnName: "experimentListData",
  shapeName: "ExperimentListItem[]",
  dataFn: (input) => experimentListData(input),
  specKeys: [],
  validate: validateExperimentListData,
  web: (props, ctx) => (
    <ExperimentListWeb
      data={props.data}
      filter={props.filter}
      relativeTo={props.relativeTo}
      locale={props.locale ?? ctx.locale}
      attemptHref={hrefOf(props, ctx)}
      className={props.className}
    />
  ),
  text: (props, ctx) => experimentListText(props.data, ctx, props.relativeTo),
}) as unknown as ReportComponent<ExperimentListProps>;

export type EvalListProps = DataProps<readonly EvalListItem[], Record<never, never>, EntityListChrome>;

/** Eval 列表:每项一个 experimentId + evalId,展开到这道题的 Attempt。 */
export const EvalList = makeDataComponent<readonly EvalListItem[], Record<never, never>, EntityListChrome>({
  name: "EvalList",
  dataFnName: "evalListData",
  shapeName: "EvalListItem[]",
  dataFn: (input) => evalListData(input),
  specKeys: [],
  validate: validateEvalListData,
  web: (props, ctx) => (
    <EvalListWeb
      data={props.data}
      locale={props.locale ?? ctx.locale}
      attemptHref={hrefOf(props, ctx)}
      className={props.className}
    />
  ),
  text: (props, ctx) => evalListText(props.data, ctx),
}) as unknown as ReportComponent<EvalListProps>;

export type AttemptListProps = DataProps<
  readonly AttemptListItem[],
  Record<never, never>,
  EntityListChrome & {
    /** 过滤 / 截断前的总数;省略时等于 data 长度。 */
    total?: number;
    /** web 面加过滤输入框(按 experiment、eval、agent、verdict 或摘要文本收窄行);渐进增强,不改变数据与 text 面。 */
    filter?: boolean;
  }
>;

/** Attempt 列表:实体列表的叶子层,每项一次 attempt 的判定、单行摘要与 locator。 */
export const AttemptList = makeDataComponent<
  readonly AttemptListItem[],
  Record<never, never>,
  EntityListChrome & { total?: number; filter?: boolean }
>({
  name: "AttemptList",
  dataFnName: "attemptListData",
  shapeName: "AttemptListItem[]",
  dataFn: (input) => attemptListData(input),
  specKeys: [],
  validate: validateAttemptListData,
  web: (props, ctx) => (
    <AttemptListWeb
      data={props.data}
      total={props.total}
      filter={props.filter}
      locale={props.locale ?? ctx.locale}
      attemptHref={hrefOf(props, ctx)}
      className={props.className}
    />
  ),
  text: (props, ctx) => attemptListText(props.data, props.total, ctx),
}) as unknown as ReportComponent<AttemptListProps>;

// ───────────────────────── FailureList(官方组合件)─────────────────────────

export interface FailureListProps {
  /** 显示的最大条数;默认 20。 */
  limit?: number;
  /** 默认宿主注入的 Scope。 */
  input?: ReportInput;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}

/**
 * 「现在有哪些失败要处理」的成品组合件:内部就是 attemptListData → 过滤 → AttemptList
 * data 形态,与手写组合严格等价、没有私有能力(docs/feature/reports/library/entity-lists.md)。
 * verdict ∈ failed / errored,按 attempt 开始时间降序(同刻按 locator 字典序),
 * 截断到 limit(默认 20),total 报告截断前总数。
 */
export const FailureList = defineComponent<FailureListProps>(async (props, ctx) => {
  const input = props.input ?? ctx.scope;
  const all = await attemptListData(input);
  // attempt 开始时间不在列表条目里(它不是列表展示字段);从同一 input 的读取面按 locator 对回。
  const startedAtByLocator = new Map<string, string>();
  for (const item of collectItems(resolveInput(input).snapshots)) {
    startedAtByLocator.set(locatorOf(item), item.attempt.result.startedAt ?? "");
  }
  const failures = all
    .filter((item) => item.verdict === "failed" || item.verdict === "errored")
    .sort((a, b) => {
      const ta = startedAtByLocator.get(a.locator) ?? "";
      const tb = startedAtByLocator.get(b.locator) ?? "";
      if (ta !== tb) return ta < tb ? 1 : -1; // 最近的失败在前
      return a.locator < b.locator ? -1 : a.locator > b.locator ? 1 : 0;
    });
  const limit = props.limit ?? 20;
  return (
    <AttemptList
      data={failures.slice(0, limit)}
      total={failures.length}
      attemptHref={props.attemptHref}
      locale={props.locale}
      className={props.className}
    />
  );
});
FailureList.displayName = "FailureList";

// ───────────────────────── 站点组件(Hero / PoweredBy / ScopeWarnings / CopyFixPrompt / TraceWaterfall)─────────────────────────

/** `Hero` 的 props:标题缺省取 `ctx.report.title`(回退链后的站点标题)。 */
export interface HeroProps {
  /** 覆盖标题;省略时取 ctx.report.title(回退链后的站点标题)。 */
  title?: LocalizedText;
  className?: string;
}

/** HeroCard 的 data 校验入口(它不经 makeDataComponent,数据形态是唯一形态)。 */
const assertHeroData = (data: unknown): HeroData => {
  const problem = validateHeroData(data);
  if (problem !== null) throw dataShapeError("HeroCard", "heroData", "HeroData", problem);
  return data as HeroData;
};

/**
 * `HeroCard`:Hero 的渲染件,双面组件,只收 data 形态——标题输入是站点声明与 Scope 的
 * 合成物,没有单独的 spec 等价形。web 面渲染 hero 标题(h1)、按渲染 locale 格式化的运行
 * meta(latestStartedAt 为 null 时内置「暂无运行」文案)与品牌行(等同 PoweredBy,恒含、
 * 无拆除 prop);text 面输出标题行与 meta 行,不含品牌行
 * (docs/feature/reports/library/site-components.md「HeroCard」)。
 */
export const HeroCard = defineComponent<HeroCardProps>({
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

/** `HeroCard` 的 props:标题 + `heroData()` 的产物,只有 data 形态。 */
export interface HeroCardProps {
  title: LocalizedText;
  data: HeroData;
  className?: string;
}

/**
 * `Hero`:页首的站点标题区——标题、最后运行时间、快照合成来源,恒含品牌行。官方组合组件,
 * 与手写 `<HeroCard title={title ?? ctx.report.title} data={await heroData(ctx.scope)} />`
 * 严格等价、没有私有能力;读 `ctx.report` 意味着输出跟随站点,要站点无关的标题区直接用
 * `HeroCard` 显式传值(docs/feature/reports/library/site-components.md「Hero」)。
 */
export const Hero = defineComponent<HeroProps>(async ({ title, className }, ctx) => (
  <HeroCard title={title ?? ctx.report.title} data={await heroData(ctx.scope)} className={className} />
));
Hero.displayName = "Hero";

/**
 * `PoweredBy`:唯一的品牌件,无 props 双面组件。web 面渲染指向 niceeval 官网的一行品牌色
 * 小字(`utm_source=report&utm_medium=powered-by`,`rel` 仅 `noopener` 以保留 Referer);
 * text 面零输出。没有任何配置——品牌契约是「提供一个组件,不给开关」:不想要品牌就不用
 * 这些组件、自己写替代组件(docs/feature/reports/library/site-components.md「PoweredBy」)。
 */
export const PoweredBy = defineComponent<Record<never, never>>({
  web: () => <PoweredByWeb />,
  text: () => "",
});
PoweredBy.displayName = "PoweredBy";

/** `ScopeWarnings` 的 props:spec 形态取宿主 Scope 的 warnings,data 形态收 `ScopeWarning[]`。 */
export type ScopeWarningsProps = DataProps<readonly ScopeWarning[], Record<never, never>, ChromeProps>;

/**
 * `ScopeWarnings`:选择警告区,警告的唯一呈现组件。把 Scope 携带的 `ScopeWarning[]`
 * 按「下一步动作」聚合渲染(带 experimentId 的按实验聚合、非实验作用域按 kind 聚合;
 * integrity 组在前);web 面组头带去重后的可复制命令、明细收原生 `<details>`(总条数 ≤ 3
 * 默认展开),text 面同构但不折叠。空警告集与裸 `Snapshot[]` 输入两面零输出
 * (docs/feature/reports/library/site-components.md「ScopeWarnings」)。
 */
export const ScopeWarnings = makeDataComponent<readonly ScopeWarning[], Record<never, never>, ChromeProps>({
  name: "ScopeWarnings",
  dataFnName: "scopeWarningsData",
  shapeName: "ScopeWarning[]",
  dataFn: (input) => scopeWarningsData(input),
  specKeys: [],
  validate: validateScopeWarningsData,
  web: (props, ctx) =>
    props.data.length === 0 ? null : (
      <ScopeWarningsWeb data={props.data} locale={props.locale ?? ctx.locale} className={props.className} />
    ),
  text: (props, ctx) => scopeWarningsText(props.data, ctx),
}) as unknown as ReportComponent<ScopeWarningsProps>;

/** `CopyFixPrompt` 的 props:spec 形态无选项,data 形态收 `copyFixPromptData()` 的产物。 */
export type CopyFixPromptProps = DataProps<CopyFixPromptData, Record<never, never>, ChromeProps>;

/**
 * `CopyFixPrompt`:把当前范围的全部失败整理成一段可交给 coding agent 的修复 prompt。
 * prompt 在 resolve 阶段算好、烘进静态 HTML,无 JS 时在折叠块里完整可读,「复制」是增强层
 * 行为;`failures` 为 0 时两面零输出;text 面恒零输出——终端里的等价能力是 `show` 的
 * attempt 下钻命令本身(docs/feature/reports/library/site-components.md「CopyFixPrompt」)。
 */
export const CopyFixPrompt = makeDataComponent<CopyFixPromptData, Record<never, never>, ChromeProps>({
  name: "CopyFixPrompt",
  dataFnName: "copyFixPromptData",
  shapeName: "CopyFixPromptData",
  dataFn: (input) => copyFixPromptData(input),
  specKeys: [],
  validate: validateCopyFixPromptData,
  web: (props, ctx) =>
    props.data.failures === 0 ? null : (
      <CopyFixPromptWeb data={props.data} locale={props.locale ?? ctx.locale} className={props.className} />
    ),
  text: () => "",
}) as unknown as ReportComponent<CopyFixPromptProps>;

/** `TraceWaterfall` 的 props:spec 形态无选项,data 形态收 `traceWaterfallData()` 的产物。 */
export type TraceWaterfallProps = DataProps<
  readonly TraceWaterfallRow[],
  Record<never, never>,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>;

/**
 * `TraceWaterfall`:每个 attempt 一行的执行时间瀑布,用 canonical OTel 字段显示被测 agent
 * 的原始 span(agent / model / tool)。web 面静态渲染顶层 span 分解条(失败 span 带失败
 * 标记),行链接 attempt 详情;text 面每 attempt 一行(locator、总耗时、span 计数与失败
 * 标记)+ 可复制的 `--timing` 下钻命令。trace 缺失的行照常出现并如实显示缺失;runner
 * 生命周期节点不进瀑布(docs/feature/reports/library/site-components.md「TraceWaterfall」)。
 */
export const TraceWaterfall = makeDataComponent<
  readonly TraceWaterfallRow[],
  Record<never, never>,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>({
  name: "TraceWaterfall",
  dataFnName: "traceWaterfallData",
  shapeName: "TraceWaterfallRow[]",
  dataFn: (input) => traceWaterfallData(input),
  specKeys: [],
  validate: validateTraceWaterfallData,
  web: (props, ctx) => (
    <TraceWaterfallWeb
      data={props.data}
      attemptHref={hrefOf(props, ctx)}
      locale={props.locale ?? ctx.locale}
      className={props.className}
    />
  ),
  text: (props, ctx) => traceWaterfallText(props.data, ctx),
}) as unknown as ReportComponent<TraceWaterfallProps>;

// ───────────────────────── 指标组件 ─────────────────────────

export type MetricTableProps = DataProps<
  TableData,
  MetricTableOptions,
  ChromeProps & {
    /** web 面在表格前渲染过滤输入框(enhance.js 接管);无 JS 时表格内容依旧完整。 */
    filter?: boolean;
    attemptHref?: (locator: AttemptLocator) => string;
  }
>;

/** 榜单:一行一个维度值、一列一个指标,回答「谁整体更好」。 */
export const MetricTable = makeDataComponent<
  TableData,
  MetricTableOptions,
  ChromeProps & { filter?: boolean; attemptHref?: (locator: AttemptLocator) => string }
>({
  name: "MetricTable",
  dataFnName: "metricTableData",
  shapeName: "TableData",
  dataFn: metricTableData,
  specKeys: ["rows", "columns", "sort", "evals"],
  validate: validateTableData,
  web: (props, ctx) => (
    <MetricTableWeb
      data={props.data}
      filter={props.filter}
      locale={props.locale ?? ctx.locale}
      attemptHref={hrefOf(props, ctx)}
      className={props.className}
    />
  ),
  text: (props, ctx) => tableText(props.data, ctx),
}) as unknown as ReportComponent<MetricTableProps>;

export type MetricMatrixProps = DataProps<
  MatrixData,
  MetricMatrixOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>;
export type MetricBarsProps = MetricMatrixProps;

/** 逐题格子:行 × 列两个维度、格子里一个指标,回答「哪道题谁挂了」。 */
export const MetricMatrix = makeDataComponent<
  MatrixData,
  MetricMatrixOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>({
  name: "MetricMatrix",
  dataFnName: "metricMatrixData",
  shapeName: "MatrixData",
  dataFn: metricMatrixData,
  specKeys: ["rows", "columns", "cell", "evals"],
  validate: validateMatrixData,
  web: (props, ctx) => (
    <MetricMatrixWeb data={props.data} locale={props.locale ?? ctx.locale} attemptHref={hrefOf(props, ctx)} className={props.className} />
  ),
  text: (props, ctx) => matrixText(props.data, ctx),
}) as unknown as ReportComponent<MetricMatrixProps>;

/** 分组条形:同一份矩阵数据的另一种摆法;与 MetricMatrix 写同一份 spec 时只计算一次。 */
export const MetricBars = makeDataComponent<
  MatrixData,
  MetricMatrixOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>({
  name: "MetricBars",
  dataFnName: "metricMatrixData",
  shapeName: "MatrixData",
  dataFn: metricMatrixData,
  specKeys: ["rows", "columns", "cell", "evals"],
  validate: validateMatrixData,
  web: (props, ctx) => (
    <MetricBarsWeb data={props.data} locale={props.locale ?? ctx.locale} attemptHref={hrefOf(props, ctx)} className={props.className} />
  ),
  text: (props, ctx) => barsText(props.data, ctx),
}) as unknown as ReportComponent<MetricBarsProps>;

export type ScoreboardProps = DataProps<
  ScoreboardData,
  ScoreboardOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>;

/** 考试成绩单:总分 + 分科小计,固定分母、notRun / unscorable 分开如实报。 */
export const Scoreboard = makeDataComponent<
  ScoreboardData,
  ScoreboardOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>({
  name: "Scoreboard",
  dataFnName: "scoreboardData",
  shapeName: "ScoreboardData",
  dataFn: scoreboardData,
  specKeys: ["rows", "questions", "subject", "weights", "fullMarks", "score"],
  validate: validateScoreboardData,
  web: (props, ctx) => <ScoreboardWeb data={props.data} locale={props.locale ?? ctx.locale} className={props.className} />,
  text: (props, ctx) => scoreboardText(props.data, ctx),
}) as unknown as ReportComponent<ScoreboardProps>;

type ScatterChrome = ChromeProps & {
  /** series 内按 x 升序成线(呈现,不改变 ScatterData):web 面画折线,text 面在图例给逐段位移摘要;默认 false。 */
  connect?: boolean;
  pointHref?: (row: ScatterData["rows"][number]) => string;
};

export type MetricScatterProps = DataProps<ScatterData, MetricScatterOptions, ScatterChrome>;

/** 两个指标之间的取舍:每个点一个维度值,x / y 各一个指标,series 决定颜色和图例归类。 */
export const MetricScatter = makeDataComponent<ScatterData, MetricScatterOptions, ScatterChrome>({
  name: "MetricScatter",
  dataFnName: "metricScatterData",
  shapeName: "ScatterData",
  dataFn: metricScatterData,
  specKeys: ["points", "series", "x", "y", "evals"],
  validate: validateScatterData,
  web: (props, ctx) => (
    <MetricScatterWeb
      data={props.data}
      connect={props.connect}
      pointHref={props.pointHref}
      locale={props.locale ?? ctx.locale}
      className={props.className}
    />
  ),
  text: (props, ctx) => scatterText(props.data, ctx, { connect: props.connect }),
}) as unknown as ReportComponent<MetricScatterProps>;

export type MetricLineProps = DataProps<
  LineData,
  MetricLineOptions,
  ChromeProps & { pointHref?: (row: LineData["rows"][number]) => string }
>;

/** 趋势线:x 是 NumericAxis(参数轴),点身份 = (series, x)。 */
export const MetricLine = makeDataComponent<
  LineData,
  MetricLineOptions,
  ChromeProps & { pointHref?: (row: LineData["rows"][number]) => string }
>({
  name: "MetricLine",
  dataFnName: "metricLineData",
  shapeName: "LineData",
  dataFn: metricLineData,
  specKeys: ["x", "series", "y", "evals"],
  validate: validateLineData,
  web: (props, ctx) => (
    <MetricLineWeb data={props.data} pointHref={props.pointHref} locale={props.locale ?? ctx.locale} className={props.className} />
  ),
  text: (props, ctx) => lineText(props.data, ctx),
}) as unknown as ReportComponent<MetricLineProps>;

export type DeltaTableProps = DataProps<
  DeltaData,
  DeltaTableOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>;

/** 成对对比:每行一对(字面声明或 pairsByFlag 派生),格子里 A、B、Δ 三个值。 */
export const DeltaTable = makeDataComponent<
  DeltaData,
  DeltaTableOptions,
  ChromeProps & { attemptHref?: (locator: AttemptLocator) => string }
>({
  name: "DeltaTable",
  dataFnName: "deltaTableData",
  shapeName: "DeltaData",
  dataFn: deltaTableData,
  specKeys: ["by", "pairs", "metrics", "evals"],
  validate: validateDeltaData,
  web: (props, ctx) => <DeltaTableWeb data={props.data} locale={props.locale ?? ctx.locale} className={props.className} />,
  text: (props, ctx) => deltaText(props.data, ctx),
}) as unknown as ReportComponent<DeltaTableProps>;
