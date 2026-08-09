// niceeval/report 的公开类型:读数(AttemptMetric)、维度(Dimension / flag() / runConfig())与
// 计算函数产物(即组件的 data)。数据契约照 docs/feature/reports/library/ 各分篇;
// 这些不是持久化格式,没有 format / schemaVersion 信封,兼容性跟随 npm 版本
// (组件消费 data 时校验结构,不符按完整用户反馈报错并提示版本漂移)。

import type { AttemptHandle, Sample, SampleCoverage, SampleIssue, SampleMissing, Run } from "../../record/types.ts";
import type { AttemptIdentity, AttemptLocator } from "../../record/locator.ts";
import type { AttemptEvidenceCapabilities } from "../../record/attempt-evidence.ts";
import type {
  AttemptError,
  DiagnosticRecord,
  ExperimentRunInfo,
  CommandExitEvidence,
  InputRequest,
  JsonValue,
  PhaseTiming,
  SourceLoc,
  ToolName,
  TraceSpan,
  Usage,
  Verdict,
} from "../../types.ts";
import type { EvaluationFactResult } from "../../assertions/types.ts";
import type { FactUseResult, AttemptTerminal } from "../../record/fact-record.ts";
import type { DiffFile } from "../definition/primitives/diff-lines.ts";
import type { CalloutGroup } from "../definition/primitives/callouts-logic.ts";
import type { LocalizedText, ReportLocale } from "./locale.ts";
import type { MetricValue } from "./calculation.ts";
export type { MetricValue } from "./calculation.ts";

export type { SampleIssue, SampleCoverage };
export type { AttemptLocator };
export type { LocalizedText, ReportLocale };

/** 所有官方计算函数的第一参:Sample(issues 随行)或手工挑的快照数组(没有挑选过程,自然无警告)。 */
export type ReportInput = Sample | readonly Run[];

// ───────────────────────── 指标与聚合 ─────────────────────────

/** 两级聚合里单级的折叠方式。 */
export type Aggregator = "mean" | "sum" | "min" | "max" | ((values: readonly number[]) => number);

/**
 * 两级聚合:「每格 attempt 数相等」是幻觉(earlyExit 让失败的题天然比通过的题样本多),
 * 平铺求均值会让分数和重试策略纠缠;所以先题内折叠、再跨题折叠,默认宏平均。
 */
export interface AttemptMetricAggregate {
  /** 第一级:同一 experiment × eval 的多个 attempt 先折成题级值;默认 "mean"。 */
  perEval?: Aggregator;
  /** 第二级:题级值再跨 experiment × eval 折成终值;默认 "mean"。 */
  acrossEvals?: Aggregator;
}

/**
 * 指标:纯函数,吃一个 AttemptHandle 吐一个值(null = 此 attempt 测不了这个指标,
 * 不进聚合;0 = 测了结果是零,照常进),外加名字、两级聚合方式和渲染提示。
 * 内置指标与自定义指标是同一个类型,没有特权。name 走字面量泛型:列键锚在指标
 * 对象上(`row.cells[taskPassRate.name]`),拼错列名编译不过。
 */
export interface AttemptMetric<Name extends string = string> {
  /** MetricColumn.key 与列头的来源;同一次计算里重名是错误。 */
  name: Name;
  /** 列头;省略时用 name。渲染面按 locale 解析,缺项走 LocalizedText 回退规则。 */
  label?: LocalizedText;
  description?: LocalizedText;
  /** 驱动内置格式化:"%" → 87%、"ms" → 1.2s、"$" → $0.31、其余 → 1.2k 缩写。 */
  unit?: string;
  /** 渲染提示:越高越好还是越低越好(排序方向、轴向、涨跌配色用)。 */
  better?: "higher" | "lower";
  /**
   * 指标值的自然边界(如通过率 0–1、成本下界 0)。图轴呼吸边距不越过声明的边界——
   * 贴边数据点如实落在框线上(如通过率 100%),那是指标的自然边界,不是裁剪
   * (docs/feature/reports/components/charts/README.md「值域」)。
   */
  bounds?: { min?: number; max?: number };
  /**
   * 声明式前置:不满足 → null,语义等价于在 value 开头 return null。
   * 单独设字段是因为这一步最容易忘(忘了它,code-golf 会奖励「写得短的坏代码」)。
   */
  where?: (attempt: AttemptHandle) => boolean;
  value(attempt: AttemptHandle): number | null | Promise<number | null>;
  /** 同一 experiment × eval 的多个 attempt 先折成题级值；默认 mean。 */
  perEval?: Aggregator;
  /** 题级值再跨 experiment × eval 折成终值；默认 mean。 */
  acrossEvals?: Aggregator;
  /** 覆盖 unit 驱动的内置格式化;只格式化同一个终值,不按 locale 分裂计算口径。 */
  display?: (value: number, locale: ReportLocale) => string;
}

// ───────────────────────── 维度与数值轴 ─────────────────────────

/**
 * 内置维度就是结果已有的身份字段。
 * - "evalGroup" = eval id 的完整父路径("a/b/c" → "a/b";无 "/" 取完整 id,与可比组同一条派生规则)
 * - "run"  = "<experimentId> @ <startedAt>",把两次快照并排成行
 */
export type BuiltInDimension = "agent" | "model" | "experiment" | "eval" | "evalGroup" | "run";

/** 自定义维度:一个函数把 attempt 分到组。 */
export interface CustomDimension {
  name: string;
  of(attempt: AttemptHandle): string;
}

/**
 * flag() / label() / runConfig() 的产物:把 experiment 声明的 flag、报告标注 label 或
 * 顶层运行配置当分组维度。读取的落盘值可能是任意形状,分组显示键按稳定 JSON 规则生成;
 * 缺失值显示内置文案 `(missing)`,不同原始值撞出同一显示键时计算报错并要求改用 CustomDimension。
 */
export type DimensionRef =
  | {
    readonly kind: "flag";
    readonly name: string;
    readonly label?: LocalizedText;
    readonly unit?: string;
  }
  | {
    readonly kind: "label";
    readonly name: string;
    readonly label?: LocalizedText;
    readonly unit?: string;
  }
  | {
    readonly kind: "runConfig";
    readonly name: RunConfigKey;
    readonly label?: LocalizedText;
    readonly unit?: string;
  };

/** 维度槽的输入:内置维度、自定义维度,或 flag() / label() / runConfig() 的产物。 */
export type DimensionInput = BuiltInDimension | CustomDimension | DimensionRef;

/**
 * series 类选项(Scatter / Line / SampleOverview)的输入:单维度,或
 * 非空数组解析为复合维度——name 依声明顺序以 ` × ` 连接,每个 attempt 的值为各成员显示键
 * 以 ` · ` 连接,任一成员缺失沿用 `(missing)` 显示键参与连接(docs/feature/reports/library/measures.md)。
 */
export type SeriesInput = DimensionInput | readonly [DimensionInput, ...DimensionInput[]];

/** MetricLine 的 x 轴:必须是数值;字符串配置显式映射,组件不猜 low < medium < high。 */
export interface NumericAxis {
  name: string;
  label?: LocalizedText;
  unit?: string;
  of(attempt: AttemptHandle): number | null;
}

export interface DimensionOptions {
  label?: LocalizedText;
  unit?: string;
}

export interface NumericAxisOptions extends DimensionOptions {}

export interface NumericRunConfigAxisOptions extends NumericAxisOptions {
  /** 字符串配置到数值轴的显式映射;数值配置不需要。 */
  map?: Readonly<globalThis.Record<string, number>>;
}

/** runConfig() 的可用键:ExperimentRunInfo 字段全集,外加桥接到快照顶层权威字段的 model / agent。 */
export type RunConfigKey = keyof ExperimentRunInfo | "model" | "agent";

// ───────────────────────── 计算产物(组件 data)─────────────────────────

export interface MetricColumn {
  /** = metric.name,与 cells 的键对应。 */
  key: string;
  /** 数据层原样携带 metric.label(可本地化);渲染面按 locale 解析。 */
  label: LocalizedText;
  description?: LocalizedText;
  unit?: string;
  /** 渲染提示:排序方向、轴向、涨跌配色。 */
  better?: "higher" | "lower";
  /** = metric.bounds,原样投影;图轴值域推定读这里(docs/feature/reports/components/charts/README.md「值域」)。 */
  bounds?: { min?: number; max?: number };
}

/**
 * 通用读数投影(docs/feature/reports/library/measures.md):本次选择的 Dimension + AttemptMetric
 * 组成的按需 Dataset。Chart / Table 只按字段名绑定，不重新读取 Record。
 */
export interface DatasetField {
  name: string;
  kind: "dimension" | "metric";
  valueType: "string" | "number";
  unit?: string;
  better?: "higher" | "lower";
  bounds?: { min?: number; max?: number };
}

export type DatasetValue = string | number | MetricValue;

export interface DatasetRow {
  /** 由全部 dimension 原始值组成的稳定身份，不是数组位置或显示 label。 */
  key: string;
  values: Readonly<globalThis.Record<string, DatasetValue>>;
}

export interface Dataset<Row extends DatasetRow = DatasetRow> {
  fields: readonly DatasetField[];
  rows: readonly Row[];
}


export interface MatrixData {
  rowDimension: string;
  columnDimension: string;
  metric: MetricColumn;
  /** 稀疏格子:没有 attempt 的组合不生成格子。 */
  cells: Array<{ row: string; column: string; cell: MetricValue }>;
}

export interface LineData {
  x: { key: string; label: LocalizedText; unit?: string };
  seriesDimension?: string;
  y: MetricColumn;
  rows: Array<{
    /** 点身份 = (series, x):x 值的稳定十进制字符串,同一 series 内唯一。 */
    key: string;
    series?: string;
    x: number | null;
    xDisplay: LocalizedText;
    y: MetricValue;
  }>;
}

export interface ScoreboardData {
  rowDimension: string;
  questions: string[];
  fullMarks: number;
  /** 实际生效的权重表(最长前缀在前)—— 成绩单可审计。 */
  weights: Array<{ prefix: string; weight: number }>;
  /** Sample 中存在但不在题集内、被忽略的 eval 数(注脚显示)。 */
  ignoredEvals: number;
  rows: Array<{
    key: string;
    total: {
      /** fullMarks × earned / possible。 */
      value: number;
      display: LocalizedText;
      /** 题集中该行完全没有 attempt 的题数(按 0 计,分开计数)。 */
      notRun: number;
      /** 有 attempt 但指标为 null(测不了)的题数(按 0 计,分开计数)。 */
      unscorable: number;
      refs: AttemptLocator[];
    };
    subjects: Array<{
      key: string;
      /** 加权后的 [0, 1] 题目分数之和。 */
      earned: number;
      /** 本分科题目的权重之和。 */
      possible: number;
      questions: number;
      notRun: number;
      unscorable: number;
      display: LocalizedText;
      refs: AttemptLocator[];
    }>;
  }>;
}

/**
 * `DeltaTable` 的一格:同一条件值 × eval 的折叠(docs/feature/reports/calculations.md)。`verdict` / `totalScore` 用与默认报告同一套题目级判定口径(`totalScore` 取各
 * attempt 的均值);`totalTokens` / `totalCostUSD` 是该题在该条件下全部 attempt 的**合计**,
 * 不是均值。
 */
export interface DeltaCell {
  evaluationKind: "pass" | "score";
  /** 复用 Record 的判定枚举,不为组件发明第二套。 */
  verdict: Verdict;
  /** 计分制的题目级挣分;通过制省略——计分制没有满分分母。 */
  totalScore?: number;
  attempts: readonly AttemptLocator[];
  totalTokens?: number;
  totalCostUSD?: number;
}

export interface DeltaData {
  byDimension: string;
  /** 有序条件值,首个是基准。 */
  conditions: string[];
  /** conditionsByFlag 派生形态下的候选实验数;0 候选时空态据此报「N 个实验、0 个可配对条件」,字面 conditions 不携带。 */
  experiments?: number;
  rows: Array<{
    /** 行的配对身份:eval id。 */
    key: string;
    /** 各条件判定不一致时 true——翻转标记 ⇄ 的数据面。 */
    flipped: boolean;
    /** 键是条件值;该条件没有这道题的结果时无键,渲染为占位 —。 */
    cells: globalThis.Record<string, DeltaCell>;
    /** 键是非基准条件值;任一侧缺数据时无键——delta 不把缺失当 0。 */
    delta?: globalThis.Record<string, { score?: number; tokens?: number; costUSD?: number }>;
  }>;
  /** 各条件自身覆盖面的描述,分母是该条件有结果的 eval 数;不用于跨条件直接归因。 */
  totals: globalThis.Record<
    string,
    {
      evaluationKindComposition: "pass" | "score" | "mixed";
      passed?: number;
      denominator?: number; // pass / mixed
      totalScore?: number; // points / mixed
      totalTokens?: number;
      totalCostUSD?: number;
    }
  >;
  /** 只在每个条件与基准的共同 eval 集上计算;键是非基准条件值。 */
  pairedDelta: globalThis.Record<
    string,
    {
      commonEvalIds: string[];
      /** mixed 时各自在对应题型子集配对,不共用一个含混分母。 */
      pass?: { knownEvalIds: string[]; passRatePoints: number };
      points?: { knownEvalIds: string[]; totalScore: number };
      tokens?: number;
      costUSD?: number;
    }
  >;
}

/** conditionsByFlag() 的产物:按一个 flag 机械导出全部有序条件;只在 by 为 "experiment" 时成立。 */
export interface FlagConditions {
  readonly kind: "flagConditions";
  readonly flag: string;
  /** 基准侧的 flag 取值;缺省表示「未声明该 flag」的实验作基准。 */
  readonly baseline?: JsonValue;
}

// ───────────────────────── StabilityMatrix ─────────────────────────

/** `StabilityMatrix` 的一格:全部历史执行(跨快照按身份键去重,不设可比性门槛)的判定计数。 */
export interface StabilityMatrixCell {
  passed: number;
  failed: number;
  errored: number;
  /** passed + failed + errored 之和;skipped 不计。 */
  executions: number;
}

export interface StabilityMatrixData {
  rowDimension: string;
  columnDimension: string;
  rows: Array<{
    evalId: string;
    /** 全部条件历史执行中通过次数为 0 且执行数 > 0。 */
    neverPassed: boolean;
  }>;
  /** 贡献了至少一格的列值,字典序。 */
  columns: readonly string[];
  /** 稀疏格子:该 (eval, column) 组合没有任何历史执行时不生成格子,渲染面显示占位 —,不编三个 0 冒充跑过。 */
  cells: ReadonlyArray<{
    row: string;
    column: string;
    cell: StabilityMatrixCell;
    /** 本格覆盖的全部历史执行,与 counts 同一集合——格与散点点位的下钻证据,字典序。 */
    refs: readonly AttemptLocator[];
  }>;
  /** 各列的合计。 */
  totals: globalThis.Record<string, StabilityMatrixCell>;
}

// ───────────────────────── 概览(SampleSummary / SampleOverview)─────────────────────────

export interface VerdictTally {
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
}

/**
 * 一个范围内出现的题型构成:`"pass"` 全部通过制、`"score"` 全部计分制、`"mixed"` 两者都有
 * (同一个 experiment 或多个 experiment 并排都可能形成 mixed)。是定义期事实
 * (`EvalDescriptor.evaluationKind`),不依赖 attempt 执行结果(docs/feature/reports/library/measures.md
 * 「题型构成与主读数」)。
 */
export type EvaluationKindComposition = "pass" | "score" | "mixed";

/**
 * 一个范围的摘要:快照时间窗、experiment / eval / attempt 数、两级判定计票、端到端通过率
 * 和总成本。eval 的身份键是 experimentId + evalId;data 恒携带两级计票,渲染面显示哪一级
 * 由呈现 prop `votes` 决定,不改变 data(docs/feature/reports/components/summaries/sample-summary.md)。
 */
export interface SampleSummaryContent {
  /** 贡献当前数据的快照时间范围;空范围为 null,不编造当前时间。 */
  range: { earliestStartedAt: string | null; latestStartedAt: string | null };
  experiments: number;
  /** experimentId + evalId 的去重计数,与 evalVerdicts 同分母。 */
  evals: number;
  attempts: number;
  /** 每个 experimentId + evalId 先折成最终 verdict 后计票。 */
  evalVerdicts: VerdictTally;
  /** attempt 原始计票,不折叠。 */
  attemptVerdicts: VerdictTally;
  /** 官方两级 endToEndPassRate,不从任一计票重算。 */
  endToEndPassRate: MetricValue;
  /**
   * 该 Sample 内出现的题型:`"pass"` 全部通过制(默认,与此字段引入前行为一致)、`"score"`
   * 全部计分制、`"mixed"` 两者都有(同一个 experiment 也可以选择两种题型,
   * 见 docs/feature/experiments/score-points.md)。
   * 渲染面据此决定主 KPI:`"score"` 隐藏通过率只显示 `totalScore`;`"mixed"` 两者都显示;
   * `"pass"` 只显示通过率、`totalScore` 省略——不摆空列。
   */
  evaluationKindComposition: EvaluationKindComposition;
  /** 计分制总分(totalScore 指标)。仅 `evaluationKindComposition` 为 `"score"` 或 `"mixed"` 时出现。 */
  totalScore?: MetricValue;
  /** costUSD 按 attempt 求和;缺失成本不伪造为 0。 */
  totalCostUSD: MetricValue;
}

// ───────────────────────── 站点组件(Hero / CopyFixPrompt / TraceWaterfall)─────────────────────────

/**
 * `HeroCard` 的数据(docs/feature/reports/components/site/hero-card.md):站点标题区的
 * 运行 meta——最后运行时间与快照合成来源。标题不在 data 里,它是站点声明与 Sample 的合成物,
 * 经 `HeroCardProps.title` 传入。
 */
export interface HeroData {
  /** Sample 中最新快照的开始时间;空 Sample 为 null,不编造当前时间。 */
  latestStartedAt: string | null;
  /** 贡献当前水位的快照数;大于 1 时 web 面标注「由 N 次运行合成」。 */
  runs: number;
}

/**
 * `SnapshotDiagnostics` 一条来源快照的诊断投影(docs/feature/reports/library.md):
 * 只携带 experimentId / startedAt / DiagnosticRecord,不带 Run 本体、`evals` 或
 * `AttemptHandle`,避免把文件读取能力拖进浏览器边界。
 */
export interface SnapshotDiagnosticsItem {
  experimentId: string;
  startedAt: string;
  diagnostics: readonly DiagnosticRecord[];
}

/**
 * `SnapshotDiagnostics` 的数据:只投影 diagnostics 非空的真实 Run,按 experiment id
 * 字典序排列,同一实验内按 startedAt 从新到旧排列;不跨快照合并 DiagnosticRecord。
 */
export type SnapshotDiagnosticsData = readonly SnapshotDiagnosticsItem[];

/**
 * `CopyFixPrompt` 的数据:resolve 期算好的修复 prompt 全文与参与的失败数
 * (docs/feature/reports/components/summaries/sample-fix-prompt.md)。
 */
export interface CopyFixPromptData {
  /** 修复 prompt 全文;失败逐条含 eval id、主失败摘要与 attempt 下钻命令。 */
  prompt: string;
  /** 参与 prompt 的失败 attempt 数(verdict 为 failed / errored)。 */
  failures: number;
}

/** `TraceWaterfall` 一行里的一个顶层 span 摘要(canonical OTel 字段归一后的形态)。 */
export interface TraceSpanSummary {
  name: string;
  /** 归一后的语义角色;turn 归入 agent,未识别落 other。 */
  kind: "agent" | "model" | "tool" | "other";
  /** 相对该 attempt trace 起点的偏移(毫秒)。 */
  startOffsetMs: number;
  durationMs: number;
  /** span status 为 error 时 true(web 面失败标记的来源)。 */
  failed: boolean;
}

/**
 * `TraceWaterfall` 一行 = 一次 attempt 的执行时间瀑布摘要。只画被测 agent 的原始 span
 * (trace.json);runner 生命周期节点(`result.phases`)不进瀑布,组合视图归 attempt 详情。
 */
export interface TraceWaterfallRow {
  experimentId: string;
  evalId: string;
  locator: AttemptLocator;
  /** trace.json 缺失或为空时 null;行照常出现,证据位置如实显示缺失,不猜值。 */
  durationMs: number | null;
  /** 顶层 span 摘要,按 startOffsetMs 升序。 */
  spans: readonly TraceSpanSummary[];
}

// ───────────────────────── 实体列表(ExperimentList / EvalList / AttemptList)─────────────────────────
//
// 三个组件按「experiment → experimentId × eval → attempt」逐级下钻,固定展示实体事实,
// 没有列配置。每一级都以下一级的 `AttemptListItem[]` 收尾——同一个类型既是 `AttemptList`
// 自己的 data,也是 `ExperimentListEvalRow.attempts` / `EvalListItem.attempts` 的元素。

/**
 * `AttemptList` 一项 = 一次 attempt:身份、判定、算好的单行结果摘要与证据引用。
 * 完整 assertions、Judge evidence、diagnostics、cause 与 stack 不进列表 data;
 * 需要完整结构时经 locator 回读取面(resolveLocator → AttemptHandle)。
 */
export interface AttemptListItem {
  experimentId: string;
  evalId: string;
  attempt: number;
  agent: string;
  /** 该 Attempt 所属 Eval 的定义期题型；渲染面据此区分不适用读数与缺失读数。 */
  evaluationKind: "pass" | "score";
  /** Fact score attempts retain their exact terminal state for renderers/JSON. */
  terminal: AttemptTerminal;
  verdict: Verdict;
  /**
   * 该轮的单行结果摘要,已按断言摘要契约折好:failed 取主失败断言摘要,
   * errored 取结构化 error 的一层摘要(phase · code · message),passed / skipped 为 null。
   * 渲染面只做宽度截断,不重算摘要。
   */
  failureSummary: string | null;
  /** 主失败之外还有几条失败断言("+N more failures" 的 N);无失败为 0。 */
  moreFailures: number;
  /** 当前 attempt 的 examScore 与证据引用。 */
  examScore: MetricValue;
  /** 当前 attempt 的挣分(totalScore 指标);通过制 eval 为 null cell(不适用,不是缺数据)。 */
  totalScore: MetricValue;
  /** 当前 attempt 的完整模型 tokens：uncached input、cache read、cache creation 与 output。 */
  tokens: MetricValue;
  durationMs: number;
  /** 缺失为 null(测不了),不伪造 0;attempt 级条目的缺失一律用 null,不用省略字段。 */
  costUSD: number | null;
  /** 执行时刻(携带条目为原执行时刻)。 */
  startedAt: string;
  locator: AttemptLocator;
}

/**
 * `EvalList` 一项 = 一个 `experimentId + evalId`(同一个 Eval 跑在两个 experiment 上是
 * 两条不同结果,不合并)。失败原因只存在于各 AttemptListItem,不在 Eval 父项重复一份。
 */
export interface EvalListItem {
  experimentId: string;
  evalId: string;
  /** 任一轮 passed 即 passed,否则 failed > errored > skipped。 */
  verdict: Verdict;
  examScore: MetricValue;
  /** 该题挣分(totalScore 指标,多轮按 perEval mean 折叠);通过制 eval 为 null cell。 */
  totalScore: MetricValue;
  durationMs: MetricValue;
  costUSD: MetricValue;
  attempts: AttemptListItem[];
}

/** `ExperimentList` 一项里,一个 Eval 的展开行。 */
export interface ExperimentListEvalRow {
  evalId: string;
  /** 该 Eval 在所选快照中出现的题型构成；通常为单型，跨历史定义变化时可为 mixed。 */
  evaluationKind: EvaluationKindComposition;
  verdict: Verdict;
  /** 只对通过制 Eval 聚合；计分制 Eval 为不适用的 null cell。 */
  endToEndPassRate: MetricValue;
  /** 该题挣分;通过制 eval 为 null cell。 */
  totalScore: MetricValue;
  durationMs: MetricValue;
  costUSD: MetricValue;
  /** 该题 Attempts 的平均 tokens；也供路径段组继续按 acrossEvals mean 聚合。 */
  tokens: MetricValue;
  attempts: AttemptListItem[];
}

/**
 * `experimentListData` 的一项 = 一个 experiment:身份(experimentId/agent/model)、
 * 声明的 flags、eval 级最终 verdict 计票、官方两级聚合汇总指标,以及展开到每道 Eval 的
 * `evalRows`(按 eval id 升序)。一行只有一套 agent / model / flags 是输入约束:
 * 同一 experiment 混入不一致可比性配置时计算按完整用户反馈失败。
 */
export interface ExperimentListItem {
  experimentId: string;
  agent: string;
  model?: string;
  flags?: globalThis.Record<string, JsonValue>;
  /** 该 experiment 内出现的题型构成；混型时通过率与总分分别聚合、并排展示。 */
  evaluationKind: EvaluationKindComposition;
  /** eval 级最终 verdict 计票(Result 列的构成)。 */
  evalVerdicts: VerdictTally;
  /** 仅聚合该 Experiment 内的通过制 Eval；纯计分制时为 null cell。 */
  endToEndPassRate: MetricValue;
  /** 实验总分(totalScore 指标:perEval mean、acrossEvals sum);通过制实验为 null cell。 */
  totalScore: MetricValue;
  costUSD: MetricValue;
  durationMs: MetricValue;
  tokens: MetricValue;
  /** 这个 experiment 覆盖的 eval 数(去重后,与 evalVerdicts 四项之和一致)。 */
  evals: number;
  /** 这个 experiment 覆盖的 attempt 总数(原始计数,含多轮重试)。 */
  attempts: number;
  /** 覆盖分母:来自 `scope.coverage` 的 knownEvalIds,与缺口共同组成已知题全集。 */
  knownEvalIds: readonly string[];
  /**
   * 当前配置下没有 Attempt 的题(来自 `scope.coverage` 的 `SampleMissing` 数组);
   * 原因只解释下一步,不构成另一种结果状态,也不进入任何聚合读数。
   */
  missing: readonly SampleMissing[];
  /** 所含快照中最近的 startedAt。 */
  lastRunAt: string;
  evalRows: ExperimentListEvalRow[];
}

// ───────────────────────── Experiment 详情组件族 ─────────────────────────

/**
 * `ExperimentDetails` 的 data(docs/feature/reports/components/experiment-detail/README.md):
 * 六区块共享同一份转换结果。`experiment` 就是收窄到单个 experiment 后的 `experimentListData`
 * 的那一项——实验身份、读数摘要、结果构成、题目清单与覆盖缺口都是它的字段,不重复搬一份;
 * `catchUpCommand` / `notices` / `diagnostics` 是这个组件独有的三块:补跑命令、experiment
 * 收窄之后的 sample notices 与 run notices(与首页同一对 `toSampleNotices` / `toRunNotices`,
 * 只是输入 Sample 已经窄到一个 experiment)。
 */
export interface ExperimentDetailsData {
  experiment: ExperimentListItem;
  /** `experiment.missing` 非空时的补跑命令(`niceeval exp <experimentId>`);否则 null。 */
  catchUpCommand: string | null;
  /** experiment 收窄后的挑选警告(scope warnings)。 */
  notices: readonly CalloutGroup[];
  /** experiment 收窄后的 run diagnostics。 */
  diagnostics: readonly CalloutGroup[];
}

// ───────────────────────── Attempt 详情组件族 ─────────────────────────
//
// 11 个叶子组件的 data 契约(docs/feature/reports/components/attempt-detail/README.md)。每个都由
// 同名 `attempt*Data(evidence: AttemptEvidence)` 同步派生,不读文件、不 fetch——
// loadAttemptEvidence 已经一次性装配好全部证据。`AttemptSummary` 恒非空;其余在对应
// 能力位为空时函数返回 null,两面渲染为空输出。

/** `AttemptSummary` 的 data:身份、verdict、时间与成本——恒非空。 */
export interface AttemptSummaryData {
  locator: AttemptLocator;
  /** 展示归属；不参与 locator 的 `{ runId, evalId, attempt }` 哈希。 */
  experimentId: string;
  identity: AttemptIdentity;
  /** Exact Fact score terminal; `verdict` is only the four-way compatibility projection. */
  terminal: AttemptTerminal;
  verdict: Verdict;
  startedAt?: string;
  durationMs: number;
  costUSD: number | null;
  capabilities: AttemptEvidenceCapabilities;
  /** Score outcome's diagnostic raw total; never used for aggregation. */
  earnedScore?: number;
  /** Score outcome's aggregation value: invalid is 0, unavailable/errored/skipped are null. */
  creditedScore?: number | null;
}

/**
 * `AttemptError` 的 data:结构化 error 一层原因 + cause + stack;没有 error 时 null。
 * `commandEvidenceHint` 只在 `error.message` 疑似只剩某条非零命令 stdout/stderr 的截断尾部
 * (message 是该字段去首尾空白后的真严格后缀)且存在失败命令证据时为 `true`——两面渲染据此在
 * 错误摘要后提示 `failed command evidence: niceeval show <locator> --execution`
 * (docs/feature/reports/show/execution.md)。
 */
export interface AttemptErrorData extends AttemptError {
  /** text 面拼 `niceeval show <locator> --execution` 提示命令用;web 面不需要。 */
  locator: AttemptLocator;
  commandEvidenceHint?: true;
}

/**
 * `AttemptAssertions` 保留组件名，但数据只包含 Fact producer 与 Fact use consumer。
 */
export interface AttemptAssertionsData {
  factResults: readonly EvaluationFactResult[];
  factUses: readonly FactUseResult[];
}

/** `AttemptFixPrompt` 的 data:单条 attempt 的复制修复 prompt;passed/skipped 或无可操作失败时 null。 */
export interface AttemptFixPromptData {
  prompt: string;
}

/** `AttemptTimeline` 的 data:runner 阶段主链 + 收尾段,以及可选的 trace(供 turn 节点按 traceId 关联 span);没有 phase 时 null。 */
export interface AttemptTimelineData {
  /** text 面拼 `niceeval show <locator> --timing` 下钻命令用;web 面不需要。 */
  locator: AttemptLocator;
  phases: PhaseTiming[];
  trace: TraceSpan[] | null;
  /** 超时 attempt 的 workspace.diff 是收尾段补折叠(不入主链口径),渲染面据此归类;非超时省略。 */
  timedOut?: true;
}

/** `AttemptConversation` 一轮:由带 `loc` 的 user 消息开启;`loc` 缺省表示流首无位置信息的兜底轮(旧 artifact)。 */
export interface AttemptConversationRound {
  loc?: SourceLoc;
  sentText: string;
  replies: AttemptConversationReply[];
}

/** 一轮内的回复条目；与闭合 StreamEvent ADT 一一投影，不保存未归一的未知事件。 */
export type AttemptConversationReply =
  | { kind: "assistant" | "user" | "thinking" | "error"; text: string }
  | { kind: "tool"; operationId: string; name: string; tool?: ToolName; input: JsonValue; output?: JsonValue; status?: "completed" | "failed" | "rejected" }
  | { kind: "skill"; skill: string }
  | { kind: "context"; text: string; source?: string }
  | { kind: "subagent"; operationId: string; name: string; remoteUrl?: string; output?: JsonValue; status?: "completed" | "failed" }
  | { kind: "input"; request: InputRequest }
  | { kind: "compaction"; reason?: string };

/** `AttemptConversation` 的 data:标准事件流按 loc 分轮;没有 events 时 null。 */
export interface AttemptConversationData {
  /** text 面拼 `niceeval show <locator> --execution` 下钻命令用;web 面不需要。 */
  locator: AttemptLocator;
  rounds: AttemptConversationRound[];
}

/** 独立的生命周期命令证据项;不属于 Conversation 的轮次或消息。 */
export interface AttemptCommandEvidence extends CommandExitEvidence {
  key: string;
  /** 消费层由 checked + exitCode 推导,不落盘:exitCode 为 0 是 "succeeded";非零时 checked 才是 "failed",否则是 "observed"。 */
  classification: "succeeded" | "observed" | "failed";
  /** 从关联 timing node 派生,缺少 timing 时省略。 */
  durationMs?: number;
}

/** `commands.json` 的报告投影;按 timing 顺序供 show 与 Web 独立命令区块消费。 */
export interface AttemptCommandEvidenceData {
  locator: AttemptLocator;
  commands: AttemptCommandEvidence[];
}

/** `AttemptDiagnostics` 的 data:按 lifecycle phase 分组;没有 diagnostics 时 null。 */
export interface AttemptDiagnosticsData {
  groups: { phase: string; items: DiagnosticRecord[] }[];
}

/**
 * `UsageTable` 的 data:判定、轮数、工具调用数、token 拆分与成本摊成的单行用量摘要;组装口径单源
 * 见 docs/feature/reports/components/attempt-detail/attempt-usage.md#组装口径单源。identity 字段
 * (`locator`/`experimentId`/`evalId`/`attempt`/`verdict`)恒有——它们不是「usage 有没有」的一部分,
 * 是这一行归属哪个 attempt 的身份。其余字段各自独立地只在事实真实存在时出现:
 *
 * - `turns`/`toolCalls`:events 派生(与 `o11y.json` 行为摘要同源),只在有非空 events 时出现,
 *   哪怕派生值恰好是 0(有 events 但零轮/零工具调用是观测到的事实,不是缺失)。
 * - `usage`:落盘 `Usage` 原样,只在 `result.usage` 存在时出现。桶恒互斥,`inputTokens` 本身
 *   就是未缓存输入(契约见 docs/feature/record/architecture.md#usage);"uncached in" 标注只在
 *   `cacheReadTokens` 在场时由 face 层给出,不派生第二个字段。
 * - `estimatedCostUSD`:能算出成本(`usage.costUSD` 或 `result.estimatedCostUSD`)时才出现。
 *
 * `turns`/`toolCalls`/`usage` 三者全部缺失时(没有 events 也没有落盘 usage)整个 data 为
 * null——「没有 usage 时零输出」,与其余 10 个叶子同一条空证据规则。
 */
export interface UsageTableData {
  locator: AttemptLocator;
  experimentId: string;
  evalId: string;
  attempt: number;
  /** Exact score terminal; verdict remains the compatibility projection for tallies. */
  terminal: AttemptTerminal;
  verdict: Verdict;
  turns?: number;
  toolCalls?: number;
  usage?: Usage;
  estimatedCostUSD?: number;
}

/**
 * `AttemptFacts` 的 data:attempt 作用域 `ctx.fact()` 上报的运行事实完整键值表
 * (见 docs/feature/record/architecture.md#facts运行事实)，按落盘的 key 插入顺序排列。
 * `AttemptRecord.facts` 缺失或为空对象时整个 data 为 null,不渲染空表。
 */
export interface AttemptFactsData {
  facts: { key: string; value: string | number | boolean }[];
}

/** `AttemptTrace` 的 data:不与 runner 节点合并的原始 OTel span 列表;没有 trace 时 null。 */
export interface AttemptTraceData {
  /** text 面拼 `niceeval show <locator> --timing` 下钻命令用;web 面不需要。 */
  locator: AttemptLocator;
  spans: TraceSpan[];
}

/**
 * `AttemptDiff` 的 data:文件级摘要加逐窗口 patch;`files` 的形状单源在 `DiffView`
 * (`DiffFile`,src/report/definition/primitives/diff-lines.ts)。
 * 没有 diff 证据时整段 `null`,有证据但 agent 没有净改动时 `files` 为空数组。
 */
export interface AttemptDiffData {
  /** text 面拼 `niceeval show <locator> --diff` 下钻命令用;web 面不需要。 */
  locator: AttemptLocator;
  files: readonly DiffFile[];
}
