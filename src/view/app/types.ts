import type {
  AssertionResult,
  EvalResult,
  JsonValue,
  LocalizedText,
  SourceArtifact,
  SourceLoc,
  StreamEvent,
  TraceSpan,
  Usage,
} from "../../types.ts";

export type { LocalizedText };

export type Locale = "en" | "zh-CN";

export type Tab = "experiments" | "runs" | "traces";
export type SortKey = "experiment" | "model" | "agent" | "avgDurationMs" | "passRate" | "tokens" | "cost";
export type SortDir = 1 | -1;

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

export interface ViewRow {
  key: string;
  experimentId?: string;
  experiment?: EvalResult["experiment"];
  group?: string;
  label: string;
  agent: string;
  model?: string;
  runs: number;
  evals: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  scored?: number;
  passRate: number;
  avgDurationMs: number;
  usage: Usage;
  estimatedCostUSD?: number;
  lastRunAt?: string;
  results: ViewResult[];
}

export type ViewResult = EvalResult & {
  artifactBase?: string;
  artifactAbsBase?: string;
  hasEvents?: boolean;
  hasTrace?: boolean;
  hasSources?: boolean;
};

export type Assertion = AssertionResult;

export interface ViewData {
  rows?: ViewRow[];
  /** 项目名(来自 config.name);hero 标题,可按 locale 多语言。 */
  name?: LocalizedText;
  lastRun: string;
  passRate: string;
  resultCount: string;
  duration: string;
  cost: string;
  /** schemaVersion 与当前 view 不同的 run;不解析内容,只渲染占位提示。 */
  incompatibleRuns?: IncompatibleRunNotice[];
}

export interface IncompatibleRunNotice {
  /** run 目录,相对 cwd。 */
  dir: string;
  schemaVersion: number;
  producerVersion?: string;
  /** 服务端拼好的查看命令:npx niceeval@<producerVersion> view <dir>。 */
  command: string;
}

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
  | { kind: "tool"; ev: ActionCalledEvent; result?: ActionResultEvent };

export type ActionCalledEvent = Extract<StreamEvent, { type: "action.called" }>;
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
