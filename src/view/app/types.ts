import type {
  AssertionResult,
  JsonValue,
  LocalizedText,
  SourceArtifact,
  SourceLoc,
  StreamEvent,
  TraceSpan,
  Usage,
} from "../../types.ts";
import type { ViewData, ViewEvalResult } from "../shared/types.ts";

export type { LocalizedText };
// Locale 只在 i18n 内核声明一次;页面数据形状与 server 共用 shared/types.ts 的声明。
export type { Locale } from "../../i18n/core.ts";
export type {
  AttemptLocator,
  ReportSlotHtml,
  SkippedRunNotice,
  ViewData,
  ViewSnapshot,
} from "../shared/types.ts";

export type Tab = "report" | "runs" | "traces";

/** 前端拿到的单条 attempt 结果就是瘦身后的 EvalResult(locator / artifactBase 由 loader 注入)。 */
export type ViewResult = ViewEvalResult;

export type Assertion = AssertionResult;

export type Verdict = "passed" | "failed" | "errored" | "skipped" | string;

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
