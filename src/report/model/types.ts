// niceeval/report 的公开类型:指标(Metric)、维度(Dimension / flag() / runConfig())与
// 计算函数产物(即组件的 data)。数据契约照 docs/feature/reports/library/ 各分篇;
// 这些不是持久化格式,没有 format / schemaVersion 信封,兼容性跟随 npm 版本
// (组件消费 data 时校验结构,不符按完整用户反馈报错并提示版本漂移)。

import type { AttemptHandle, Scope, ScopeCoverage, ScopeWarning, Snapshot } from "../../results/types.ts";
import type { AttemptIdentity, AttemptLocator } from "../../results/locator.ts";
import type { AttemptEvidenceCapabilities } from "../../results/attempt-evidence.ts";
import type { AnnotatedEvalSourceSummary, AnnotatedSourceLine } from "../../results/annotated-source.ts";
import type {
  AssertionResult,
  AttemptError,
  DiagnosticRecord,
  ExperimentRunInfo,
  InputRequest,
  JsonValue,
  PhaseTiming,
  ScoreEntry,
  SourceLoc,
  ToolName,
  TraceSpan,
  Usage,
  Verdict,
} from "../../types.ts";
import type { LocalizedText, ReportLocale } from "./locale.ts";

export type { ScopeWarning, ScopeCoverage };
export type { AttemptLocator };
export type { LocalizedText, ReportLocale };

/** 所有官方计算函数的第一参:Scope(warnings 随行)或手工挑的快照数组(没有挑选过程,自然无警告)。 */
export type ReportInput = Scope | readonly Snapshot[];

// ───────────────────────── 指标与聚合 ─────────────────────────

/** 两级聚合里单级的折叠方式。 */
export type Aggregator = "mean" | "sum" | "min" | "max" | ((values: readonly number[]) => number);

/**
 * 两级聚合:「每格 attempt 数相等」是幻觉(earlyExit 让失败的题天然比通过的题样本多),
 * 平铺求均值会让分数和重试策略纠缠;所以先题内折叠、再跨题折叠,默认宏平均。
 */
export interface MetricAggregate {
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
export interface Metric<Name extends string = string> {
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
   * (docs/feature/reports/library/metric-views.md「图轴值域」)。
   */
  bounds?: { min?: number; max?: number };
  /**
   * 声明式前置:不满足 → null,语义等价于在 value 开头 return null。
   * 单独设字段是因为这一步最容易忘(忘了它,code-golf 会奖励「写得短的坏代码」)。
   */
  where?: (attempt: AttemptHandle) => boolean;
  value(attempt: AttemptHandle): number | null | Promise<number | null>;
  aggregate?: MetricAggregate;
  /** 覆盖 unit 驱动的内置格式化;只格式化同一个终值,不按 locale 分裂计算口径。 */
  display?: (value: number, locale: ReportLocale) => string;
}

// ───────────────────────── 维度与数值轴 ─────────────────────────

/**
 * 内置维度就是结果已有的身份字段。
 * - "evalGroup" = eval id 的完整父路径("a/b/c" → "a/b";无 "/" 取完整 id,与可比组同一条派生规则)
 * - "snapshot"  = "<experimentId> @ <startedAt>",把两次快照并排成行
 */
export type BuiltInDimension = "agent" | "model" | "experiment" | "eval" | "evalGroup" | "snapshot";

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
export interface DimensionRef {
  readonly kind: "flag" | "runConfig" | "label";
  readonly name: string;
  readonly label?: LocalizedText;
  readonly unit?: string;
}

/** 维度槽的输入:内置维度、自定义维度,或 flag() / label() / runConfig() 的产物。 */
export type DimensionInput = BuiltInDimension | CustomDimension | DimensionRef;

/**
 * series 类选项(MetricScatter / MetricLine / ExperimentComparison)的输入:单维度,或
 * 非空数组解析为复合维度——name 依声明顺序以 ` × ` 连接,每个 attempt 的值为各成员显示键
 * 以 ` · ` 连接,任一成员缺失沿用 `(missing)` 显示键参与连接(docs/feature/reports/library/metrics.md)。
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
  map?: Readonly<Record<string, number>>;
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
  /** = metric.bounds,原样投影;图轴值域推定读这里(docs/feature/reports/library/metric-views.md「图轴值域」)。 */
  bounds?: { min?: number; max?: number };
}

export interface MetricCell {
  /** 聚合后的值;null = 该组没有任何有效样本。 */
  value: number | null;
  /**
   * 已格式化的显示值;计算函数为官方生成面覆盖的每个 locale(当前 en、zh-CN)生成,
   * renderer 按 LocalizedText 回退规则选择,其它 locale 回退 en。
   */
  display: LocalizedText;
  /** 有效 attempt 数(指标返回非 null 的 attempt)。 */
  samples: number;
  /** 本格子覆盖的 attempt 总数,包含值为 null 的 attempt。 */
  total: number;
  /**
   * 本格子覆盖的全部 attempt(包含指标值为 null 的证据)—— 回到证据的引用。必填(可空数组):
   * 「每个数字点进去就是证据」是页面的核心承诺,可选字段会让深链静默缺失。
   */
  refs: AttemptLocator[];
}

/**
 * 数据形状的字段命名规则(docs/feature/reports/library/metric-views.md「共用数据形状」):
 * 维度名字段 = 产生它的选项名 + `Dimension` 后缀,值是解析后的维度 name;
 * 条目数组一律叫 `rows`(Matrix 的稀疏格子叫 `cells`);条目内的 key / series 是维度值,不带后缀。
 */
export interface TableData {
  rowDimension: string;
  columns: MetricColumn[];
  rows: Array<{
    key: string;
    cells: Record<string, MetricCell>;
  }>;
}

export interface MatrixData {
  rowDimension: string;
  columnDimension: string;
  metric: MetricColumn;
  /** 稀疏格子:没有 attempt 的组合不生成格子。 */
  cells: Array<{ row: string; column: string; cell: MetricCell }>;
}

export interface ScatterData {
  pointDimension: string;
  seriesDimension?: string;
  /** 轴方向跟随 better:lower 反向渲染(值大在左/下),「更好」恒指向右上;刻度显示真实值。 */
  x: MetricColumn;
  y: MetricColumn;
  rows: Array<{
    key: string;
    series?: string;
    x: MetricCell;
    /** 任一为 null 的点组件不画,注脚如实报数(点仍留在 rows 里,可数)。 */
    y: MetricCell;
  }>;
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
    y: MetricCell;
  }>;
}

export interface ScoreboardData {
  rowDimension: string;
  questions: string[];
  fullMarks: number;
  /** 实际生效的权重表(最长前缀在前)—— 成绩单可审计。 */
  weights: Array<{ prefix: string; weight: number }>;
  /** Scope 中存在但不在题集内、被忽略的 eval 数(注脚显示)。 */
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

export interface DeltaData {
  byDimension: string;
  columns: MetricColumn[];
  /** FlagPairs 派生形态下的配对域实验数;字面 pairs 不携带(空态文案用)。 */
  experiments?: number;
  rows: Array<{
    key: string;
    /** 作者在 DeltaPair 里声明(或派生规则生成)的 label,原样透传;renderer 据此显示行名。 */
    label: LocalizedText;
    a: { key: string };
    b: { key: string };
    cells: Record<
      string,
      {
        a: MetricCell;
        b: MetricCell;
        /** b.value - a.value;任一侧缺失则为 null。 */
        delta: number | null;
        display: LocalizedText;
        outcome: "improved" | "regressed" | "unchanged" | "unavailable";
      }
    >;
  }>;
}

export interface DeltaPair {
  label: LocalizedText;
  a: string;
  b: string;
}

/** pairsByFlag() 的产物:按一个 flag 机械导出全部 A/B 对;只在 by 为 "experiment" 时成立。 */
export interface FlagPairs {
  readonly kind: "flagPairs";
  readonly flag: string;
  /** a 侧的 flag 取值;缺省表示「未声明该 flag」的实验作 a。 */
  readonly baseline?: JsonValue;
}

// ───────────────────────── 概览(ScopeSummary / ExperimentComparison)─────────────────────────

export interface VerdictTally {
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
}

/**
 * 一个范围内出现的题型构成:`"pass"` 全部通过制、`"points"` 全部计分制、`"mixed"` 两者都有
 * (一个 Scope 可以并排多个 experiment;题型只在单个 experiment 内被强制统一)。是定义期事实
 * (`EvalDescriptor.scoring`),不依赖 attempt 执行结果(docs/feature/reports/library/metrics.md
 * 「题型构成与主读数」)。
 */
export type ScoringComposition = "pass" | "points" | "mixed";

/**
 * 一个范围的摘要:快照时间窗、experiment / eval / attempt 数、两级判定计票、端到端通过率
 * 和总成本。eval 的身份键是 experimentId + evalId;data 恒携带两级计票,渲染面显示哪一级
 * 由呈现 prop `votes` 决定,不改变 data(docs/feature/reports/library/summaries.md)。
 */
export interface ScopeSummaryData {
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
  endToEndPassRate: MetricCell;
  /**
   * 该 Scope 内出现的题型:`"pass"` 全部通过制(默认,与此字段引入前行为一致)、`"points"`
   * 全部计分制、`"mixed"` 两者都有(一个 Scope 可以并排多个 experiment,题型只在单个
   * experiment 内被强制统一,见 docs/feature/experiments/score-points.md「横截面聚合」)。
   * 渲染面据此决定主 KPI:`"points"` 隐藏通过率只显示 `totalScore`;`"mixed"` 两者都显示;
   * `"pass"` 只显示通过率、`totalScore` 省略——不摆空列。
   */
  scoringComposition: ScoringComposition;
  /** 计分制总分(totalScore 指标)。仅 `scoringComposition` 为 `"points"` 或 `"mixed"` 时出现。 */
  totalScore?: MetricCell;
  /** costUSD 按 attempt 求和;缺失成本不伪造为 0。 */
  totalCostUSD: MetricCell;
}

// ───────────────────────── 站点组件(Hero / CopyFixPrompt / TraceWaterfall)─────────────────────────

/**
 * `HeroCard` 的数据(docs/feature/reports/library/site-components.md):站点标题区的
 * 运行 meta——最后运行时间与快照合成来源。标题不在 data 里,它是站点声明与 Scope 的合成物,
 * 经 `HeroCardProps.title` 传入。
 */
export interface HeroData {
  /** Scope 中最新快照的开始时间;空 Scope 为 null,不编造当前时间。 */
  latestStartedAt: string | null;
  /** 贡献当前水位的快照数;大于 1 时 web 面标注「由 N 次运行合成」。 */
  snapshots: number;
}

/**
 * `CopyFixPrompt` 的数据:resolve 期算好的修复 prompt 全文与参与的失败数
 * (docs/feature/reports/library/site-components.md)。
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
  verdict: Verdict;
  /**
   * 该轮的单行结果摘要,已按 Scoring display 契约折好:failed 取主失败断言摘要,
   * errored 取结构化 error 的一层摘要(phase · code · message),passed / skipped 为 null。
   * 渲染面只做宽度截断,不重算摘要。
   */
  failureSummary: string | null;
  /** 主失败之外还有几条失败断言("+N more failures" 的 N);无失败为 0。 */
  moreFailures: number;
  /** 当前 attempt 的 examScore 与证据引用。 */
  examScore: MetricCell;
  /** 当前 attempt 的挣分(totalScore 指标);通过制 eval 为 null cell(不适用,不是缺数据)。 */
  totalScore: MetricCell;
  durationMs: number;
  /** 缺失为 null(测不了),不伪造 0;attempt 级条目的缺失一律用 null,不用省略字段。 */
  costUSD: number | null;
  /** 执行时刻(携带条目为原执行时刻)。时效标注的时距从这里起算。 */
  startedAt: string;
  /** 历史执行:携带条目,或来自该实验在 Scope 中最新快照之外的快照;false = 最新一次运行实测。 */
  historical: boolean;
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
  examScore: MetricCell;
  /** 该题挣分(totalScore 指标,多轮按 perEval mean 折叠);通过制 eval 为 null cell。 */
  totalScore: MetricCell;
  durationMs: MetricCell;
  costUSD: MetricCell;
  attempts: AttemptListItem[];
}

/** `ExperimentList` 一项里,一个 Eval 的展开行。 */
export interface ExperimentListEvalRow {
  evalId: string;
  verdict: Verdict;
  /** 该题挣分;通过制 eval 为 null cell。 */
  totalScore: MetricCell;
  durationMs: MetricCell;
  costUSD: MetricCell;
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
  flags?: Record<string, JsonValue>;
  /** 该 experiment 的题型(定义期事实,单个 experiment 内由启动期强制同型)。主读数列据此选择。 */
  scoring: "pass" | "points";
  /** eval 级最终 verdict 计票(Result 列的构成)。 */
  evalVerdicts: VerdictTally;
  endToEndPassRate: MetricCell;
  /** 实验总分(totalScore 指标:perEval mean、acrossEvals sum);通过制实验为 null cell。 */
  totalScore: MetricCell;
  costUSD: MetricCell;
  durationMs: MetricCell;
  tokens: MetricCell;
  /** 这个 experiment 覆盖的 eval 数(去重后,与 evalVerdicts 四项之和一致)。 */
  evals: number;
  /** 这个 experiment 覆盖的 attempt 总数(原始计数,含多轮重试)。 */
  attempts: number;
  /** 历史执行的 attempt 数(分母是 attempts);时效标注「↩ n/m attempts」的数据源。 */
  historicalAttempts: number;
  /** 已知 eval 并集里、当前口径下没有任何 attempt 的题(来自 `scope.coverage`);渲染为占位行。 */
  missingEvalIds: string[];
  /** 所含快照中最近的 startedAt。 */
  lastRunAt: string;
  evalRows: ExperimentListEvalRow[];
}

// ───────────────────────── Attempt 详情组件族 ─────────────────────────
//
// 11 个叶子组件的 data 契约(docs/feature/reports/library/attempt-detail.md)。每个都由
// 同名 `attempt*Data(evidence: AttemptEvidence)` 同步派生,不读文件、不 fetch——
// loadAttemptEvidence 已经一次性装配好全部证据。`AttemptSummary` 恒非空;其余在对应
// 能力位为空时函数返回 null,两面渲染为空输出。

/** `AttemptSummary` 的 data:身份、verdict、时间与成本——恒非空。 */
export interface AttemptSummaryData {
  locator: AttemptLocator;
  identity: AttemptIdentity;
  verdict: Verdict;
  startedAt?: string;
  durationMs: number;
  costUSD: number | null;
  capabilities: AttemptEvidenceCapabilities;
  /**
   * 计分制(`scoring: "points"`)attempt 本轮挣分:`assertions[].points` 之和(排除 unavailable)
   * 加 `scoreEntries[].points` 之和;详情页总分位的唯一出现处,其它区块不重复这个总数
   * (docs/feature/scoring/library/display.md「计分制」)。通过制 eval 恒省略,不是 0——
   * 题型判定读定义期 `result.scoring`,不从结果推断。
   */
  totalScore?: number;
}

/** `AttemptError` 的 data:结构化 error 一层原因 + cause + stack;没有 error 时 null。 */
export type AttemptErrorData = AttemptError;

/**
 * `AttemptAssertions` 的 data:非 passed 条目默认展开,passed 按 group 折叠计数;没有 assertion
 * 且没有给分记录时 null。计分制(`scoring: "points"`)eval 的 `.points` 挣分随所在
 * `AssertionResult` 一起出现在 `attention` / `passedGroups` 里(字段本就在 `AssertionResult` 上,
 * 不需要额外投影);`t.score(label, n)` 的直接给分记录另成一个分组数组,见 `scoreEntries`
 * (docs/feature/scoring/library/display.md「计分制:.points 与给分记录」)。
 */
export interface AttemptAssertionsData {
  /**
   * failed / unavailable / soft 全部非 passed 条目,按原始声明顺序;计分制的得分点(带
   * `.points`)豁免 passed 收纳——即使 outcome 是 passed 也进这个平铺列表,不折进
   * `passedGroups`(docs/feature/scoring/library/display.md「得分点不参与 passed 收纳」)。
   * 计分制前置中止时,中止断言(记录顺序最后一条,必为 failed gate)带 `aborted: true`——
   * 其后不再有任何断言或给分记录,展示时紧跟一个中止标注(`⤓`,见「计分制」)。
   */
  attention: (AssertionResult & { aborted?: true })[];
  /**
   * passed 条目按 groupPath.join(" > ") 分组(无分组键为 ""),组内保持原始顺序;只包含不带
   * `.points` 的观测断言——收纳规则不吞掉分数面的明细。
   */
  passedGroups: { group: string; items: AssertionResult[] }[];
  /**
   * `t.score(label, n)` 记录,按 groupPath.join(" > ") 分组(无分组键为 "",同 passedGroups
   * 同一套分组算法),组内保持记录顺序。只在存在给分记录时出现;省略表示没有给分记录
   * (通过制 eval 的 attempt 恒省略)。
   */
  scoreEntries?: { group: string; items: ScoreEntry[] }[];
  /**
   * 得分点挣满计数("2/5 得分点挣满"):分母是全部带 `.points` 的断言(unavailable 结构上不
   * 携带 `points`,不计入分母);挣满 = `score === 1`(连续打分断言不足 `n × 1.0` 不算挣满)。
   * 只在存在至少一个得分点时出现(通过制 eval 恒省略)。
   */
  scorePointsEarned?: { earned: number; total: number };
}

/** `AttemptSource` 源码行内的一轮执行：send 头事实 + 标准事件流归并出的完整回复。 */
export interface AttemptSourceTurn {
  label: string;
  status: "completed" | "failed" | "waiting";
  durationMs?: number;
  sentText: string;
  replies: AttemptConversationReply[];
}

/**
 * AnnotatedSourceLine 加上 web 源码视图需要的行内执行轮与计分制给分投影
 * (docs/feature/scoring/library/display.md「源码面同样承载给分证据」)。
 */
export interface AttemptSourceLineData extends AnnotatedSourceLine {
  /** 覆盖基类字段:中止断言(若映射到这一行)带 `aborted: true`,与 AttemptAssertionsData.attention 同一份标注。 */
  assertions: (AssertionResult & { aborted?: true })[];
  turns: AttemptSourceTurn[];
  /** `t.score(label, n)` 调用行原位标注的给分记录(该行 `loc` 命中的全部记录,按声明顺序)。 */
  scoreEntries: ScoreEntry[];
  /** 计分制前置中止点:此行的某条断言是让 `test()` 就地结束的 failed gate。 */
  aborted?: true;
  /** 中止行之后的未到达区:此行在中止点之后,没有任何断言或给分记录跑到这里(而不是没写)。 */
  unreached?: true;
}

/** `AttemptSource` 的 data:AnnotatedEvalSource + 按 loc 投影的标准事件流;没有 source 时 null。 */
export interface AttemptSourceData {
  /** text 面拼 `niceeval show <locator> --source` 下钻命令用;web 面不需要。 */
  locator: AttemptLocator;
  sourcePath: string;
  lines: AttemptSourceLineData[];
  unmapped: (AssertionResult & { aborted?: true })[];
  /**
   * `t.score(...)` 给分记录里 `loc` 不在展示源码内的部分,按 groupPath.join(" > ") 分组
   * (无分组键为 "",与 `AttemptAssertionsData.scoreEntries` 同一套算法)。只在存在给分记录时
   * 出现。
   */
  unmappedScoreEntries?: { group: string; items: ScoreEntry[] }[];
  /**
   * 得分点挣满计数,与 `AttemptAssertionsData.scorePointsEarned` 同一条判据(源码不可用时换成
   * `AttemptAssertions`「规则完全一致」,见 docs/feature/reports/show/attempt.md)。只在存在
   * 至少一个得分点时出现。
   */
  scorePointsEarned?: { earned: number; total: number };
  /** 没有 loc、指向其它文件或越界的轮次；不能静默丢弃，放在源码块末尾。 */
  unlocatedTurns: AttemptSourceTurn[];
  summary: AnnotatedEvalSourceSummary;
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
}

/** `AttemptConversation` 一轮:由带 `loc` 的 user 消息开启;`loc` 缺省表示流首无位置信息的兜底轮(旧 artifact)。 */
export interface AttemptConversationRound {
  loc?: SourceLoc;
  sentText: string;
  replies: AttemptConversationReply[];
}

/** 一轮内的回复条目;`raw` 是未识别事件类型的原样兜底,不吞没其余事件。 */
export type AttemptConversationReply =
  | { kind: "assistant" | "user" | "thinking" | "error"; text: string }
  | { kind: "tool"; callId: string; name: string; tool?: ToolName; input: JsonValue; output?: JsonValue; status?: "completed" | "failed" | "rejected" }
  | { kind: "skill"; skill: string }
  | { kind: "context"; text: string; source?: string }
  | { kind: "subagent"; callId: string; name: string; remoteUrl?: string; output?: JsonValue; status?: "completed" | "failed" }
  | { kind: "input"; request: InputRequest }
  | { kind: "compaction"; reason?: string }
  | { kind: "raw"; raw: JsonValue };

/** `AttemptConversation` 的 data:标准事件流按 loc 分轮;没有 events 时 null。 */
export interface AttemptConversationData {
  /** text 面拼 `niceeval show <locator> --execution` 下钻命令用;web 面不需要。 */
  locator: AttemptLocator;
  rounds: AttemptConversationRound[];
}

/** `AttemptDiagnostics` 的 data:按 lifecycle phase 分组;没有 diagnostics 时 null。 */
export interface AttemptDiagnosticsData {
  groups: { phase: string; items: DiagnosticRecord[] }[];
}

/** `AttemptUsage` 的 data:token / cache token / provider usage 明细;没有 usage 时 null。 */
export interface AttemptUsageData {
  usage: Usage;
  costUSD: number | null;
}

/** `AttemptTrace` 的 data:不与 runner 节点合并的原始 OTel span 列表;没有 trace 时 null。 */
export interface AttemptTraceData {
  /** text 面拼 `niceeval show <locator> --timing` 下钻命令用;web 面不需要。 */
  locator: AttemptLocator;
  spans: TraceSpan[];
}

/** `AttemptDiff` 一个文件的摘要:`net` 恒 !== "none"(净无变化的触碰不进这份列表)。 */
export interface AttemptDiffFileEntry {
  path: string;
  net: "added" | "modified" | "deleted";
  /** 净行数变化(公共前后缀修剪后的近似上界,与 `niceeval show --diff` 同一算法)。 */
  lines: { added: number; deleted: number };
  binary?: true;
  /** 触碰过该文件的窗口标签,按时序;供 text 面引用 `--diff` 深挖同一批窗口。 */
  windows: string[];
}

/** `AttemptDiff` 的 data:generated / modified / deleted 的文件级摘要;没有变更时 null。 */
export interface AttemptDiffData {
  /** text 面拼 `niceeval show <locator> --diff` 下钻命令用;web 面不需要。 */
  locator: AttemptLocator;
  files: AttemptDiffFileEntry[];
}
