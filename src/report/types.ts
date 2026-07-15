// niceeval/report 的公开类型:指标(Metric)、维度(Dimension / flag())与计算函数
// 产物(即组件的 data props)。数据契约照 docs/feature/reports/library.md「数据计算与缓存边界」;
// 这些不是持久化格式,没有 format / schemaVersion 信封,兼容性跟随 npm 版本。

import type { AttemptHandle, SelectionWarning } from "../results/types.ts";
import type { AttemptLocator } from "../results/locator.ts";
import type { AssertionResult, AttemptError, DiagnosticRecord, Verdict } from "../types.ts";
import type { LocalizedLabel, ReportLocale } from "./locale.ts";

export type { SelectionWarning };
export type { AttemptLocator };
export type { LocalizedLabel, ReportLocale };

// ───────────────────────── 指标与聚合 ─────────────────────────

/** 两级聚合里单级的折叠方式。 */
export type Aggregator = "mean" | "sum" | "min" | "max" | ((values: number[]) => number);

/**
 * 两级聚合:「每格 attempt 数相等」是幻觉(earlyExit 让失败的题天然比通过的题样本多),
 * 平铺求均值会让分数和重试策略纠缠;所以先题内折叠、再跨题折叠,默认宏平均。
 */
export interface MetricAggregate {
  /** 第一级:同一 (eval × 快照) 的多 attempt → 一个题级值;默认 "mean"。 */
  perEval?: Aggregator;
  /** 第二级:分组内的题级值 → 格子终值;默认 "mean"。 */
  across?: Aggregator;
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
  /**
   * 列头;省略时用 name。可以给按 locale 的字典({ en, "zh-CN" }),
   * 渲染面按宿主 locale 解析,缺项回退 en(display 是 format 产物,不本地化)。
   */
  label?: LocalizedLabel;
  description?: string;
  /** 渲染提示:越高越好还是越低越好(排序方向、轴向、涨跌配色用)。 */
  better?: "higher" | "lower";
  /** 驱动内置格式化:"%" → 87%、"ms" → 1.2s、"$" → $0.31、其余 → 1.2k 缩写。 */
  unit?: string;
  /**
   * 声明式前置:不满足 → null,语义等价于在 value 开头 return null。
   * 单独设字段是因为这一步最容易忘(忘了它,code-golf 会奖励「写得短的坏代码」)。
   */
  where?: (attempt: AttemptHandle) => boolean;
  value(attempt: AttemptHandle): number | null | Promise<number | null>;
  aggregate?: MetricAggregate;
  /** 覆盖 unit 驱动的内置格式化。 */
  display?: (value: number) => string;
}

// ───────────────────────── 维度 ─────────────────────────

/**
 * 维度:attempt 分到哪一组。内置维度就是结果已有的身份字段;自定义维度是一个函数。
 * - "evalGroup" = eval id 的第一段:"algebra/quadratic" → "algebra"(考试里的「科目」)
 * - "snapshot"  = "<experimentId> @ <startedAt>",把两次快照并排成行,与 view 的 Compare 同口径
 */
export type Dimension =
  | "agent"
  | "model"
  | "experiment"
  | "eval"
  | "evalGroup"
  | "snapshot"
  | { name: string; of: (attempt: AttemptHandle) => string };

/**
 * flag() 的产物:把 experiment 声明的 flags 当维度(series / rows / columns / points
 * 槽,按声明值分组)或轴(MetricLine 的 x 槽,要求数值并驱动刻度)。
 * 未声明该 flag 的 experiment 不猜:分组如实归「(unset)」,作轴不画点、注脚报数。
 */
export interface FlagRef {
  readonly kind: "flag";
  readonly name: string;
  /** 组标签 / 轴标签;函数形态把声明值折成组名(如 `(v) => \`${v} agents\``)。 */
  readonly label?: string | ((value: string | number | boolean) => string);
  readonly unit?: string;
}

/**
 * config() 的产物:把顶层运行配置(快照 `ExperimentRunInfo` 投影的字段全集,外加桥接到
 * 快照顶层权威字段的 `model` / `agent` 两个键)当维度或轴,槽位用法与 {@link FlagRef} 一致。
 * 未投影的值不猜:分组如实归「(unset)」,作轴不画点、注脚报数。
 */
export interface ConfigRef {
  readonly kind: "config";
  readonly name: string;
  /** 组标签 / 轴标签;函数形态把投影值折成组名。 */
  readonly label?: string | ((value: string | number | boolean) => string);
  readonly unit?: string;
}

/** MetricLine 的 x 轴输入:experiment 声明的 flag,或顶层运行配置(config())。 */
export type AxisInput = FlagRef | ConfigRef;

/** 维度槽的输入:内置/自定义维度、experiment 声明的 flag,或顶层运行配置(config())。 */
export type DimensionInput = Dimension | FlagRef | ConfigRef;

// ───────────────────────── 计算产物(组件 data props)─────────────────────────

export interface MetricColumn {
  /** = metric.name,与 cells 的键对应。 */
  key: string;
  /** 数据层原样携带 metric.label(可本地化);渲染面用 resolveMetricLabel 按 locale 解析。 */
  label: LocalizedLabel;
  unit?: string;
  /** 渲染提示:排序方向、轴向、涨跌配色。 */
  better?: "higher" | "lower";
}

export interface MetricCell {
  /** 聚合后的值;null = 该组没有任何有效样本。 */
  value: number | null;
  /** 已格式化("87%" / "1.2k lines" / "$0.31"),前端可直接渲染。 */
  display: string;
  /** 有效 attempt 数(值为 null 的不计入)。 */
  samples: number;
  /** 组内 attempt 总数;samples < total = 有 attempt 测不了这个指标。 */
  total: number;
  /**
   * 这个格子由哪些 attempt 算出 —— 回到证据的引用。必填(可空数组):
   * 「每个数字点进去就是证据」是页面的核心承诺,可选字段会让深链静默缺失。
   */
  refs: AttemptLocator[];
}

/**
 * 榜单行的元信息:rows: "experiment" 时随行(experiment 行天然有唯一的 agent/model 身份、
 * eval 级折叠计票与「这行覆盖了多少题/多少次尝试/最近何时跑的」);其它维度不携带。
 * web / text 面在 meta 在场时补 Model / Agent / Verdicts 列,`evals`/`attempts`/
 * `lastRunAt` 则渲染成行键下的一行紧凑摘要——与 view 原生榜单同一份信息密度。
 * `MetricTable` 只表达维度 × 指标,没有实体下钻——要展开到 experiment 的 Eval 或
 * Eval 的 Attempt,用 `ExperimentList` / `EvalList`,这里不再有 `subRows`。
 */
export interface TableRowMeta<K extends string = string> {
  agent?: string;
  model?: string;
  /** eval 级折叠计票(foldEvalVerdict 口径,与 view 榜单同一套):每题折成单一判定后计数。 */
  verdicts?: { passed: number; failed: number; errored: number; skipped: number };
  /**
   * `rows: "experiment"` 专属:这一行覆盖的 eval 数(去重后,summarizeItems 口径,与
   * `verdicts` 四项之和一致)。其它行维度(agent/eval/自定义…)没有「这一行是几道题」的
   * 独立语义(题本身就是行),不携带这个字段。
   */
  evals?: number;
  /**
   * `rows: "experiment"` 专属:这一行覆盖的 attempt 总数(原始计数,含多轮重试)。
   * 大于 `evals` 说明存在多轮重试(early-exit 复测 / flaky 重跑);等于 `evals` 说明
   * 每题只跑了一轮。同上,只在 `rows: "experiment"` 时语义成立。
   */
  attempts?: number;
  /**
   * `rows: "experiment"` 专属:这一行覆盖范围内快照 `startedAt` 的最大值(最近一次运行
   * 时间,ISO 8601,字符串比较即可比大小)。组内没有任何 item 时缺席。
   */
  lastRunAt?: string;
}

/** 列键 K 来自 columns 元组的字面量 name:拼错列名编译不过,不是运行时 undefined。 */
export interface TableData<K extends string = string> {
  /** 行维度名,如 "agent"。 */
  dimension: string;
  columns: MetricColumn[];
  rows: { key: string; cells: Record<K, MetricCell>; meta?: TableRowMeta<K> }[];
}

export interface MatrixData {
  /** 行维度名,如 "eval"。 */
  rows: string;
  /** 列维度名,如 "agent"。 */
  columns: string;
  metric: MetricColumn;
  /** 稀疏:没有样本的格子不出现。 */
  cells: { row: string; column: string; cell: MetricCell }[];
}

export interface ScoreboardData {
  /**
   * 被打分的维度名,如 "agent"。
   * (计算函数的维度槽叫 rows,与 MetricTable.data 统一;数据形状上行数组已占用
   * rows 一词,维度名沿用 TableData 的 dimension。)
   */
  dimension: string;
  fullMarks: number;
  /** 实际生效的权重表(按匹配顺序:最长前缀在前)—— 成绩单可审计。 */
  weights: { prefix: string; weight: number }[];
  rows: {
    key: string;
    /** 已折算到 fullMarks。 */
    total: { value: number; display: string };
    subjects: {
      /** 科目(subjects 维度的值)。 */
      key: string;
      /** 加权得分。 */
      earned: number;
      /** 科目分值合计。 */
      possible: number;
      /** 题数。 */
      evals: number;
      /** 无任何样本、按 0 计的题数 —— 固定分母的如实注脚。 */
      missing: number;
    }[];
  }[];
}

export interface ScatterData {
  /** 点维度名,如 "experiment"。 */
  points: string;
  /** 系列维度名,如 "agent"。 */
  series?: string;
  /** better: "lower" → 组件反向画轴,「好」的角落恒在右上。 */
  x: MetricColumn;
  y: MetricColumn;
  rows: {
    /** 点的键,如 "compare/bub-high"。 */
    key: string;
    /** 所属系列,如 "bub"。 */
    series?: string;
    x: MetricCell;
    /** 任一为 null 的点组件不画,注脚如实报数(点仍留在 rows 里,可数)。 */
    y: MetricCell;
  }[];
}

/** MetricLine 的 x 轴:experiment 声明的 flag,数值驱动刻度。 */
export interface LineAxis {
  /** flag 名。 */
  key: string;
  label: string;
  unit?: string;
}

export interface LineData {
  x: LineAxis;
  /** 系列维度名(flag 或普通维度)。 */
  series?: string;
  y: MetricColumn;
  rows: {
    /** 点的键(experiment id):每个点 = 一个 experiment 的聚合。 */
    key: string;
    series?: string;
    /** flag 声明值;未声明或非数值 → null,点不画、注脚报数。 */
    x: number | null;
    /** 已格式化的 x("300 ms");x 为 null 时为空串。 */
    xDisplay: string;
    y: MetricCell;
  }[];
}

/**
 * 一组 experiment(如自定义报告里同一 `<Section>` 内的全部 experiment)的摘要:
 * experiment/eval/attempt 数量、eval 级折叠计票、通过率、总成本、最后运行时间——
 * 恢复旧 `GroupSelector` 卡片曾展示的信息密度,但通过率是官方 `MetricCell` 形态,
 * 不是裸数字,渲染面不用另外拼格式。
 */
export interface GroupSummaryData {
  /** 组内 experiment 数(去重后的 experimentId 个数)。 */
  experiments: number;
  /**
   * 组内 eval 数,按完整身份键(experimentId + eval id)去重——多 experiment 的组里
   * 两个 experiment 各自的同名 eval(如都叫 "algebra/a")算两道题,不会被误合并成一道。
   */
  evals: number;
  /** 组内 attempt 总数(原始计数,一轮 attempt 一票,不折叠)。 */
  attempts: number;
  /**
   * eval 级折叠计票:同一 eval 的多轮 attempt 先折成一个判定(`foldEvalVerdict`,任一轮
   * 通过则通过,否则取最严重的),再计数——与 `TableRowMeta.verdicts`、view 榜单同一口径,
   * 不是 attempt 原始票数的直接计票。
   */
  verdicts: { passed: number; failed: number; errored: number; skipped: number };
  /**
   * 组的通过率:eval 级折叠计票的 `passed / (passed + failed + errored)`(`skipped` 不进
   * 分母)——这是旧 `GroupSelector` 卡片的口径,不是 `OverviewData.totals.passRate` 那种
   * `computeCell` 两级聚合(两者服务不同问题:「这组题多少算过」vs「整体质量几分」)。
   * 分母为 0(组内没有任何已跑的 eval)时 `value` 为 `null`,不编 0%。
   */
  passRate: MetricCell;
  /** 组内可测成本(`attemptCostUSD`)求和;一次 attempt 都没报成本 = `null`,不编 `0`。 */
  totalCostUSD: number | null;
  /** 组内快照 `startedAt` 的最大值(字符串比较,ISO 8601 天然可比);组内没有任何 item 时缺席。 */
  lastRunAt?: string;
}

export interface OverviewData {
  snapshots: { experimentId: string; agent: string; model?: string; startedAt: string }[];
  totals: {
    evals: number;
    attempts: number;
    /**
     * 四个 attempt 原始判定计票(一个 attempt 一票),独立于 `passRate`:驱动页头的
     * 判定计数展示,不是通过率公式的输入——不要从这四个数现场重算百分比。
     */
    passed: number;
    failed: number;
    errored: number;
    skipped: number;
    /**
     * 通过率的唯一官方口径:`computeCell(taskPassRate, items)`,与 `MetricTable.data(...,
     * columns: [taskPassRate])` 同一台两级聚合引擎(题内折叠 perEval、跨题折叠 across,默认都是
     * mean)——一道题内多个 attempt 部分通过,贡献的是小数份额而不是二元票。`samples`/`total`
     * 是两级聚合口径下的 attempt 计数(`total` 含 skipped 与 errored——taskPassRate 对两者都
     * 记 null 不进分母,`samples` 不含),不等于上面四个 verdict 计票的任何一个之和。
     */
    passRate: MetricCell;
    /** 任一 attempt 报了成本才有;全缺 = null,不编 0。 */
    costUSD: number | null;
    durationMs: number;
  };
  /** Selection 的警告随行(结构化,含渲染好的 message),RunOverview 直接渲染。 */
  warnings: SelectionWarning[];
}

export interface DeltaData<K extends string = string> {
  columns: MetricColumn[];
  rows: {
    /** pair 的 label,如 "bub"。 */
    key: string;
    /** 基线侧:experiment id 或快照键 "<experimentId> @ <startedAt>"。 */
    a: { experimentId: string };
    /** 对比侧。 */
    b: { experimentId: string };
    cells: Record<
      K,
      {
        a: MetricCell;
        b: MetricCell;
        /** b.value - a.value;任一侧 null → null,不硬算。 */
        delta: number | null;
        /** 已带符号("+12%" / "-$0.80" / "±0"),涨跌好坏由 better 判定。 */
        display: string;
      }
    >;
  }[];
}

// ───────────────────────── 实体列表(ExperimentList / EvalList / AttemptList)─────────────────────────
//
// 三个组件按「experiment → experimentId × eval → attempt」逐级下钻,固定展示实体事实,
// 没有列配置(docs/feature/reports/library.md「实体列表」)。每一级都以下一级的 `AttemptListItem[]`
// 收尾——同一个类型既是 `AttemptList` 自己的 items,也是 `ExperimentListEvalRow.attempts` /
// `EvalListItem.attempts` 的元素,报告作者可以直接把这些嵌套数组喂给 `<AttemptList items={...} />`。

/**
 * `AttemptList` 一项 = 一个 Attempt:身份、判定、断言、结构化 error、diagnostics、耗时、
 * 成本和 locator。`ExperimentList` / `EvalList` 的下钻数组复用同一个类型,不是各自的精简版。
 * 渲染面只显示 error 的一层摘要(`error.message`);cause / stack 与 diagnostics 属于
 * locator 下钻详情,不塞进比较列表,但随数据携带 —— `AttemptList.data` 的 `redact`
 * 钩子覆盖它们的自由文本(见 docs/feature/reports/library.md「AttemptList」)。
 */
export interface AttemptListItem {
  evalId: string;
  experimentId: string;
  attempt: number;
  agent: string;
  verdict: Verdict;
  /** 结构化执行错误(与 `EvalResult.error` 同构):列表只显示 `message` 一层摘要。 */
  error?: AttemptError;
  /** 本 attempt 的有界诊断(teardown / cleanup 失败等,与 verdict 独立);属于下钻详情。 */
  diagnostics?: DiagnosticRecord[];
  assertions: AssertionResult[];
  durationMs: number;
  costUSD?: number;
  locator: AttemptLocator;
}

/**
 * `ExperimentList` 一项里,一个 Eval 的展开行:折叠判定(`foldEvalVerdict`)、失败原因摘要
 * (`error` → `skipReason` → 未通过的 gate 断言,`reasonFor` 的口径,soft 断言永不进入)、
 * 该 Eval 内 attempt 的平均耗时/成本(两级聚合引擎在单一 eval 上退化成组内均值),以及这道题
 * 的全部 Attempt(升序,供进一步展开到 `AttemptList`)。
 */
export interface ExperimentListEvalRow {
  evalId: string;
  /** 折叠判定(任一 attempt 通过则通过,否则取最严重的)。 */
  verdict: Verdict;
  reason?: string;
  /** 这道题内 attempt 的平均耗时(`computeCell(durationMs, …)`,单一 eval 分组下即均值)。 */
  duration: MetricCell;
  /** 这道题内 attempt 的平均成本。 */
  cost: MetricCell;
  /** 这道题的全部 Attempt,按 attempt 序号升序。 */
  attempts: AttemptListItem[];
}

/**
 * `ExperimentList.data(selection)` 的一项 = 一个 experiment:身份(experimentId/agent/model)、
 * 声明的 flags、Eval 判定构成(`foldEvalVerdict` 计票,与 view 榜单同一口径)、官方两级聚合
 * 汇总指标(taskPassRate/cost/duration/tokens,直接来自 `computeCell`,不现场重算),以及展开到
 * 这个 experiment 每道 Eval 的 `evalRows`(按 eval id 升序)。
 */
export interface ExperimentListItem {
  experimentId: string;
  agent: string;
  model?: string;
  flags?: Record<string, unknown>;
  /** eval 级折叠计票(foldEvalVerdict 口径,与 `TableRowMeta.verdicts`、view 榜单同一套)。 */
  verdicts: { passed: number; failed: number; errored: number; skipped: number };
  /** 官方两级聚合口径(taskPassRate),与 `MetricTable.data(..., columns: [taskPassRate])` 同一台引擎。 */
  passRate: MetricCell;
  cost: MetricCell;
  duration: MetricCell;
  tokens: MetricCell;
  /** 这个 experiment 覆盖的 eval 数(去重后,与 `verdicts` 四项之和一致)。 */
  evals: number;
  /** 这个 experiment 覆盖的 attempt 总数(原始计数,含多轮重试)。 */
  attempts: number;
  /** 所含快照中最近的 startedAt。 */
  lastRunAt: string;
  /** 展开到这个 experiment 的 Eval,按 eval id 升序。 */
  evalRows: ExperimentListEvalRow[];
}

/**
 * `EvalList.data(selection)` 的一项 = 一个 `experimentId + evalId`(同一个 Eval 跑在两个
 * experiment 上是两条不同结果,不合并)。判定、分数(examScore 的两级聚合)、这道题内 attempt
 * 的平均耗时/成本,失败原因摘要(与 `ExperimentListEvalRow.reason` 同一口径),外加展开到这道题
 * 全部 Attempt 的 `attempts`(按 attempt 序号升序)。
 */
export interface EvalListItem {
  evalId: string;
  experimentId: string;
  verdict: Verdict;
  reason?: string;
  /** examScore 的两级聚合;单一 eval 分组下即这道题的题级分数。 */
  score: MetricCell;
  duration: MetricCell;
  cost: MetricCell;
  attempts: AttemptListItem[];
}
