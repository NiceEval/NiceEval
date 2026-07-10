import type {
  AssertionResult,
  ExperimentRunInfo,
  JsonValue,
  LocalizedText,
  SourceArtifact,
  SourceLoc,
  StreamEvent,
  TraceSpan,
  Usage,
} from "../../types.ts";
import type { MetricCell, ViewData, ViewEvalResult } from "../shared/types.ts";

export type { LocalizedText };
// Locale 只在 i18n 内核声明一次;页面数据形状与 server 共用 shared/types.ts 的声明。
export type { Locale } from "../../i18n/core.ts";
export type {
  AttemptRef,
  MetricCell,
  MetricColumn,
  OverviewData,
  SelectionWarning,
  SkippedRunNotice,
  TableData,
  ViewData,
  ViewSnapshot,
} from "../shared/types.ts";

export type Tab = "report" | "experiments" | "runs" | "traces";
export type SortKey = "experiment" | "model" | "agent" | "duration" | "passRate" | "tokens" | "cost";
export type SortDir = 1 | -1;

/**
 * Experiments 榜单一行 = 一个实验的最新快照(latest 口径)。
 * 统计数字(cells)是官方 MetricTable.data 的产物,前端只渲染;
 * 明细(results / 判决计数)是该快照的证据室数据,由 buildRows 从 viewData 拼接。
 */
export interface ViewRow {
  /** = experimentId(官方 TableData 行键)。 */
  key: string;
  experimentId: string;
  /** experimentId 是 "<agent>/<model>" 合成键时为 true(落盘缺 experimentId)。 */
  synthetic?: boolean;
  experiment?: ExperimentRunInfo;
  group?: string;
  label: string;
  agent: string;
  model?: string;
  /** 该快照的 startedAt(ISO)—— 榜单「每行带判决产生的时间」。 */
  lastRunAt: string;
  /** 默认报告格子(pass-rate / duration / tokens / cost),display 已格式化。 */
  cells: Partial<Record<string, MetricCell>>;
  /** 快照内 attempt 总数。 */
  runs: number;
  /** 折叠后的 eval 判决计数(钻取明细的展示口径,与 CLI 共用同一份折叠实现)。 */
  evals: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  /** 快照内成本合计(证据室口径的总花费;榜单列是官方的「平均每 eval 成本」格子)。 */
  totalCostUSD?: number;
  results: ViewEvalResult[];
}

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

/** 前端拿到的单条 attempt 结果就是瘦身后的 EvalResult(attemptRef / artifactBase 由 loader 注入)。 */
export type ViewResult = ViewEvalResult;

export type Assertion = AssertionResult;

export type Outcome = "passed" | "failed" | "errored" | "skipped" | string;

export interface SourceTurn {
  loc?: SourceLoc;
  sent: string;
  replies: Reply[];
}

export type Reply =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "error"; text: string }
  | { kind: "tool"; ev: ActionCalledEvent; result?: ActionResultEvent }
  | { kind: "input"; ev: InputRequestedEvent };

export type ActionCalledEvent = Extract<StreamEvent, { type: "action.called" }>;
export type InputRequestedEvent = Extract<StreamEvent, { type: "input.requested" }>;
export type ActionResultEvent = Extract<StreamEvent, { type: "action.result" }>;
export type SubagentCalledEvent = Extract<StreamEvent, { type: "subagent.called" }>;
export type SubagentCompletedEvent = Extract<StreamEvent, { type: "subagent.completed" }>;
export type ToolResultEvent = ActionResultEvent | SubagentCompletedEvent;
export type ViewJson = JsonValue;
export type ViewUsage = Usage;

export type TranscriptEvent = StreamEvent;

export interface Indexed<T> {
  byKey: Map<string, T[]>;
  noloc: T[];
}

export interface IndexedTurns {
  byKey: Map<string, SourceTurn>;
  noloc: SourceTurn[];
}

export interface CodeSource extends SourceArtifact {}

export type Span = TraceSpan;

export type ObjectRecord = Record<string, JsonValue | undefined>;

declare global {
  interface Window {
    __NICEEVAL_VIEW_DATA__?: ViewData;
  }
}
