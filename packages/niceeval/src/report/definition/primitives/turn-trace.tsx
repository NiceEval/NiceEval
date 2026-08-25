// TurnTrace: compact, server-rendered trajectory ledger.  The browser only
// filters, folds, selects, and switches pre-rendered inline evidence tabs. Tool
// start/result events remain separate in Conversation but render as one lifecycle
// row here, with both phases' evidence present in the static report body.

import type { CSSProperties, ReactElement } from "react";
import { defineComponent } from "../tree.ts";
import {
  conversationText,
  renderConversationDetail,
  sanitizeConversationPreview,
  type ConversationContent,
  type ConversationEntry,
  type ConversationTurn,
} from "./conversation.tsx";
import { resolveLocalizedText, type ReportLocale } from "../../model/locale.ts";
import type { ValueProps } from "./shared.ts";

export type TurnTraceProps = ValueProps<
  ConversationContent | null,
  { locale?: ReportLocale; className?: string }
>;

type ResolvedTurnTraceProps = {
  data: ConversationContent | null;
  locale?: ReportLocale;
  className?: string;
};

type TraceLane = "input" | "model" | "tools";

type TraceEvent = {
  readonly id: string;
  readonly turn: ConversationTurn;
  readonly turnIndex: number;
  readonly entry: ConversationEntry;
  readonly entryIndex: number;
  readonly lane: TraceLane;
  readonly summary: string;
  readonly raw: string;
  readonly toolLike: boolean;
};

type TimelinePosition = {
  readonly sequenceLeft: number;
  readonly sequenceWidth: number;
  readonly durationLeft: number;
  readonly durationWidth: number;
};

type TraceStyle = CSSProperties & Record<`--niceeval-trace-${string}`, string>;

function cx(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(" ");
}

function text(locale: ReportLocale, english: string, chinese: string): string {
  return locale === "zh-CN" ? chinese : english;
}

function durationLabel(durationMs: number | undefined): string {
  if (durationMs === undefined) return "Not recorded";
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  const seconds = Math.round(durationMs / 1_000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} m ${seconds % 60} s`;
}

function turnDuration(turn: ConversationTurn): number | undefined {
  return turn.durationMs !== undefined && Number.isFinite(turn.durationMs)
    ? Math.max(0, turn.durationMs)
    : undefined;
}

function laneFor(kind: string): TraceLane {
  switch (kind.toLowerCase()) {
    case "user":
    case "input":
    case "context":
      return "input";
    case "tool":
    case "subagent":
    case "skill":
      return "tools";
    default:
      return "model";
  }
}

function isToolLike(kind: string): boolean {
  const lane = laneFor(kind);
  return lane === "tools";
}

function callCount(events: readonly TraceEvent[]): number {
  const started = events.filter((event) => event.entry.callPhase === "started").length;
  return started === 0 ? events.filter((event) => event.toolLike).length : started;
}

function statusFor(entry: ConversationEntry, locale: ReportLocale): string {
  if (entry.callOutcome === "completed") return text(locale, "Completed", "已完成");
  if (entry.callOutcome === "failed") return text(locale, "Failed", "失败");
  if (entry.callOutcome === "rejected") return text(locale, "Rejected", "已拒绝");
  if (entry.callOutcome === "cancelled") return text(locale, "Cancelled", "已取消");
  if (entry.failed === true) return text(locale, "Failed", "失败");
  if (entry.callPhase === "started") return text(locale, "Started", "已开始");
  if (entry.callPhase === "finished") return text(locale, "Completed", "已完成");
  return text(locale, "Captured", "已捕获");
}

function lifecycleEntriesOf(
  turn: ConversationTurn,
): readonly { readonly entry: ConversationEntry; readonly entryIndex: number }[] {
  const phasesByCallId = new Map<string, { started: number[]; finished: number[] }>();
  for (const [entryIndex, entry] of turn.entries.entries()) {
    if (entry.callId === undefined || entry.callPhase === undefined) continue;
    const phases = phasesByCallId.get(entry.callId) ?? { started: [], finished: [] };
    phases[entry.callPhase].push(entryIndex);
    phasesByCallId.set(entry.callId, phases);
  }

  const lifecycleByStartedIndex = new Map<number, ConversationEntry>();
  const pairedFinishedIndexes = new Set<number>();
  for (const phases of phasesByCallId.values()) {
    // Public author data is validated structurally, not as a durable ledger. Only
    // coalesce an unambiguous 1:1 lifecycle; duplicate phases remain visible.
    if (phases.started.length !== 1 || phases.finished.length !== 1) continue;
    const startedIndex = phases.started[0]!;
    const finishedIndex = phases.finished[0]!;
    if (finishedIndex <= startedIndex) continue;
    const started = turn.entries[startedIndex]!;
    const finished = turn.entries[finishedIndex]!;
    const raw = [started.raw, finished.raw].filter((value): value is string => value !== undefined).join("\n");
    const details = [started.detail, finished.detail].filter((value) => value !== undefined);
    lifecycleByStartedIndex.set(startedIndex, {
      kind: started.kind,
      preview: started.preview,
      ...(started.anchor === undefined ? {} : { anchor: started.anchor }),
      callId: started.callId,
      callPhase: "finished",
      ...(finished.callOutcome === undefined ? {} : { callOutcome: finished.callOutcome }),
      ...(started.failed === true || finished.failed === true ? { failed: true } : {}),
      ...(raw === "" ? {} : { raw }),
      ...(details.length === 0 ? {} : { detail: details.length === 1 ? details[0] : details }),
    });
    pairedFinishedIndexes.add(finishedIndex);
  }

  return turn.entries.flatMap((entry, entryIndex) => {
    if (pairedFinishedIndexes.has(entryIndex)) return [];
    return [{ entry: lifecycleByStartedIndex.get(entryIndex) ?? entry, entryIndex }];
  });
}

function traceEventsOf(content: ConversationContent, locale: ReportLocale): readonly TraceEvent[] {
  return content.turns.flatMap((turn, turnIndex) => lifecycleEntriesOf(turn).map(({ entry, entryIndex }) => {
    const raw = entry.raw ?? resolveLocalizedText(entry.preview, locale);
    return {
      // Keep IDs safe for HTML data attributes without relying on selector
      // escaping in the enhancement runtime.  `:` separates the encoded turn
      // identity from the local ordinal and remains unambiguous here.
      id: `${encodeURIComponent(turn.key)}:${entryIndex}`,
      turn,
      turnIndex,
      entry,
      entryIndex,
      lane: laneFor(entry.kind),
      summary: sanitizeConversationPreview(entry.preview, locale, 180),
      raw,
      toolLike: isToolLike(entry.kind),
    };
  }));
}

function completeTurnTiming(turns: readonly ConversationTurn[]): boolean {
  return turns.every((turn) => turn.entries.length === 0 || turnDuration(turn) !== undefined);
}

function timelinePositions(
  turns: readonly ConversationTurn[],
  events: readonly TraceEvent[],
): ReadonlyMap<string, TimelinePosition> {
  const positions = new Map<string, TimelinePosition>();
  if (events.length === 0) return positions;

  const completeTiming = completeTurnTiming(turns);
  const sequenceUnit = 1;
  const durationUnits = new Map<string, number>();
  for (const turn of turns) {
    const entries = events.filter((event) => event.turn.key === turn.key);
    if (entries.length === 0) continue;
    const duration = turnDuration(turn);
    const unit = completeTiming && duration !== undefined
      ? Math.max(1, duration) / entries.length
      : sequenceUnit;
    for (const event of entries) durationUnits.set(event.id, unit);
  }

  const sequenceTotal = events.length * sequenceUnit;
  const durationTotal = events.reduce((total, event) => total + (durationUnits.get(event.id) ?? sequenceUnit), 0);
  let sequenceOffset = 0;
  let durationOffset = 0;
  for (const event of events) {
    const durationUnit = durationUnits.get(event.id) ?? sequenceUnit;
    positions.set(event.id, {
      sequenceLeft: sequenceOffset / sequenceTotal * 100,
      sequenceWidth: sequenceUnit / sequenceTotal * 100,
      durationLeft: durationOffset / durationTotal * 100,
      durationWidth: durationUnit / durationTotal * 100,
    });
    sequenceOffset += sequenceUnit;
    durationOffset += durationUnit;
  }
  return positions;
}

function timelineStyle(position: TimelinePosition, lane: TraceLane): TraceStyle {
  return {
    "--niceeval-trace-sequence-left": `${position.sequenceLeft}%`,
    "--niceeval-trace-sequence-width": `${position.sequenceWidth}%`,
    "--niceeval-trace-duration-left": `${position.durationLeft}%`,
    "--niceeval-trace-duration-width": `${position.durationWidth}%`,
    "--niceeval-trace-lane": lane === "input" ? "0" : lane === "model" ? "1" : "2",
  };
}

function timelineEventLabel(event: TraceEvent, locale: ReportLocale): string {
  const turnLabel = resolveLocalizedText(event.turn.label, locale);
  const duration = turnDuration(event.turn);
  const timing = duration === undefined
    ? text(locale, "timing not recorded", "未记录时长")
    : `${durationLabel(duration)} ${text(locale, "turn duration", "轮次时长")}`;
  return `${event.entry.kind} · ${turnLabel} · ${timing}`;
}

function TraceToolbar({
  content,
  events,
  locale,
}: {
  content: ConversationContent;
  events: readonly TraceEvent[];
  locale: ReportLocale;
}): ReactElement {
  const durations = content.turns.flatMap((turn) => {
    const duration = turnDuration(turn);
    return duration === undefined ? [] : [duration];
  });
  const totalDuration = durations.length === 0
    ? text(locale, "—", "—")
    : durationLabel(durations.reduce((total, duration) => total + duration, 0));
  const calls = callCount(events);
  const timingAvailable = completeTurnTiming(content.turns) && events.length > 0;

  return (
    <header className="niceeval-trace-toolbar" role="toolbar" aria-label={text(locale, "Trajectory controls", "轨迹控制")}>
      <div className="niceeval-trace-toolbar-main">
        <span className="niceeval-trace-toolbar-title">{text(locale, "Session log", "会话日志")}</span>
        <div className="niceeval-trace-toolbar-actions">
          <button
            type="button"
            className="niceeval-trace-toolbar-button niceeval-trace-toolbar-button--duration"
            data-niceeval-trace-duration
            aria-pressed="false"
            disabled={!timingAvailable}
            title={timingAvailable
              ? text(locale, "Use turn-duration projection", "按轮次时长投影")
              : text(locale, "Turn timing is incomplete; sequence stays equal-width", "轮次时长不完整；保持等宽顺序")}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.25" /><path d="M8 4.75V8l2.25 1.5" /></svg>
            <span>{text(locale, "Duration", "时长")}</span>
            <b>{totalDuration}</b>
          </button>
          <button
            type="button"
            className="niceeval-trace-toolbar-button"
            data-niceeval-trace-turns
            aria-pressed="false"
            title={text(locale, "Collapse turns", "折叠轮次")}
          >
            <span className="niceeval-trace-toolbar-glyph" aria-hidden="true">⊟</span>
            <span>{text(locale, "Turns", "轮次")}</span>
            <b>{content.turns.length}</b>
          </button>
          <button
            type="button"
            className="niceeval-trace-toolbar-button"
            data-niceeval-trace-calls
            aria-pressed="false"
            title={text(locale, "Collapse tool calls", "折叠工具调用")}
            disabled={calls === 0}
          >
            <span className="niceeval-trace-toolbar-glyph" aria-hidden="true">⊟</span>
            <span>{text(locale, "Calls", "调用")}</span>
            <b>{calls}</b>
          </button>
        </div>
      </div>
      <label className="niceeval-trace-search">
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.25" /><path d="m10.25 10.25 3 3" /></svg>
        <span className="niceeval-trace-visually-hidden">{text(locale, "Search trajectory", "搜索轨迹")}</span>
        <input
          type="search"
          data-niceeval-trace-search
          placeholder={text(locale, "Search", "搜索")}
          aria-label={text(locale, "Search trajectory", "搜索轨迹")}
        />
      </label>
    </header>
  );
}

function TraceTimeline({
  content,
  events,
  locale,
}: {
  content: ConversationContent;
  events: readonly TraceEvent[];
  locale: ReportLocale;
}): ReactElement {
  const positions = timelinePositions(content.turns, events);
  const completeTiming = completeTurnTiming(content.turns);
  const boundaries = events.filter((event, index) => index === 0 || events[index - 1]?.turn.key !== event.turn.key);
  return (
    <section
      className="niceeval-trace-timeline"
      aria-label={text(locale, "Trajectory timeline", "轨迹时间线")}
      data-niceeval-trace-timeline
      data-timing-complete={completeTiming ? "true" : undefined}
    >
      <div className="niceeval-trace-timeline-plot">
        <div className="niceeval-trace-timeline-labels" aria-hidden="true">
          <span>{text(locale, "Input / User", "输入 / 用户")}</span>
          <span>{text(locale, "Model / Assistant", "模型 / 助手")}</span>
          <span>{text(locale, "Tools / Tool", "工具 / 工具")}</span>
        </div>
        <div className="niceeval-trace-timeline-track">
          {events.length === 0 ? (
            <span className="niceeval-trace-timeline-empty">{text(locale, "No captured events", "没有已捕获事件")}</span>
          ) : null}
          {boundaries.map((event) => {
            const position = positions.get(event.id);
            return position === undefined ? null : (
              <span
                key={`boundary-${event.id}`}
                className="niceeval-trace-timeline-boundary"
                aria-hidden="true"
                style={timelineStyle(position, event.lane)}
              />
            );
          })}
          {events.map((event) => {
            const position = positions.get(event.id);
            return position === undefined ? null : (
              <button
                key={event.id}
                type="button"
                className="niceeval-trace-timeline-span"
                data-niceeval-trace-timeline-event={event.id}
                data-lane={event.lane}
                data-failed={event.entry.failed ? "true" : undefined}
                aria-label={timelineEventLabel(event, locale)}
                title={timelineEventLabel(event, locale)}
                style={timelineStyle(position, event.lane)}
              />
            );
          })}
        </div>
      </div>
      <p className="niceeval-trace-timeline-note">
        {completeTiming
          ? text(
            locale,
            "Duration projects captured turn durations; without per-event timestamps, events remain evenly sequenced within each turn.",
            "时长模式投影已捕获的轮次时长；没有逐事件时间戳时，事件在轮次内保持等宽顺序。",
          )
          : text(
            locale,
            "Per-event timing was not captured, so the timeline uses equal-width sequence spans.",
            "未捕获逐事件时长，因此时间线使用等宽顺序跨度。",
          )}
      </p>
    </section>
  );
}

function TraceEvidence({ event, locale }: { event: TraceEvent; locale: ReportLocale }): ReactElement {
  const detail = event.entry.detail === undefined ? null : renderConversationDetail(event.entry.detail);
  const duration = turnDuration(event.turn);
  return (
    <details className="niceeval-trace-evidence" data-niceeval-trace-evidence={event.id}>
      <summary>{text(locale, "Evidence", "证据")}</summary>
      <div className="niceeval-trace-evidence-body">
        <dl className="niceeval-trace-evidence-meta">
          <div><dt>{text(locale, "Source", "来源")}</dt><dd>{resolveLocalizedText(event.turn.label, locale)}</dd></div>
          <div><dt>{text(locale, "Status", "状态")}</dt><dd>{statusFor(event.entry, locale)}</dd></div>
          <div><dt>{text(locale, "Total duration", "总时长")}</dt><dd>{duration === undefined ? text(locale, "Not recorded", "未记录") : durationLabel(duration)}</dd></div>
          {event.entry.callPhase === undefined ? null : (
            <div><dt>{text(locale, "Call phase", "调用阶段")}</dt><dd>{event.entry.callPhase}</dd></div>
          )}
          {event.entry.callId === undefined ? null : (
            <div><dt>{text(locale, "Call ID", "调用 ID")}</dt><dd>{event.entry.callId}</dd></div>
          )}
        </dl>
        <div className="niceeval-trace-evidence-tabs" role="tablist" aria-label={text(locale, "Record detail tabs", "记录详情标签")}>
          <button type="button" role="tab" data-niceeval-trace-evidence-tab="preview" aria-selected="true">
            {text(locale, "Preview", "预览")}
          </button>
          <button type="button" role="tab" data-niceeval-trace-evidence-tab="raw" aria-selected="false">
            {text(locale, "Raw", "原始")}
          </button>
        </div>
        <section className="niceeval-trace-evidence-panel" data-niceeval-trace-evidence-panel="preview" role="tabpanel" aria-label={text(locale, "Preview", "预览")} data-active="true">
          <h4>{text(locale, "Preview", "预览")}</h4>
          {detail === null
            ? <pre className="niceeval-trace-evidence-raw">{event.raw}</pre>
            : <div className="niceeval-trace-evidence-detail">{detail}</div>}
        </section>
        <section className="niceeval-trace-evidence-panel" data-niceeval-trace-evidence-panel="raw" role="tabpanel" aria-label={text(locale, "Raw", "原始")} data-active="false">
          <h4>{text(locale, "Raw", "原始")}</h4>
          <pre className="niceeval-trace-evidence-raw">{event.raw}</pre>
        </section>
      </div>
    </details>
  );
}

function TraceEventRow({ event, locale }: { event: TraceEvent; locale: ReportLocale }): ReactElement {
  const turnLabel = resolveLocalizedText(event.turn.label, locale);
  const duration = turnDuration(event.turn);
  const status = statusFor(event.entry, locale);
  return (
    <article
      className={cx(
        "niceeval-trace-event-row",
        event.toolLike && "niceeval-trace-event-row--tool",
        event.entry.failed && "niceeval-trace-event-row--failed",
      )}
      data-niceeval-trace-event={event.id}
      data-niceeval-conversation-anchor={event.entry.anchor}
      data-tool-row={event.toolLike ? "true" : undefined}
      data-call-outcome={event.entry.callOutcome}
    >
      <span className="niceeval-trace-event-turn-rail" aria-hidden="true" />
      <button
        type="button"
        className="niceeval-trace-event-select"
        data-niceeval-trace-select={event.id}
        aria-pressed="false"
        aria-expanded="false"
        aria-label={`${event.entry.kind}: ${event.summary || text(locale, "captured event", "已捕获事件")}`}
      >
        <span className="niceeval-trace-event-kind" data-lane={event.lane}>{event.entry.kind}</span>
        <span className="niceeval-trace-event-summary">{event.summary || "—"}</span>
        <span className="niceeval-trace-event-meta" title={duration === undefined
          ? text(locale, "Turn timing not recorded", "未记录轮次时长")
          : `${turnLabel} · ${durationLabel(duration)}`}
        >
          {duration === undefined ? "—" : durationLabel(duration)}
        </span>
        <span className="niceeval-trace-event-status" data-call-outcome={event.entry.callOutcome}>{status}</span>
      </button>
      <TraceEvidence event={event} locale={locale} />
    </article>
  );
}

function TraceTurn({
  turn,
  events,
  locale,
}: {
  turn: ConversationTurn;
  events: readonly TraceEvent[];
  locale: ReportLocale;
}): ReactElement {
  const duration = turnDuration(turn);
  const calls = callCount(events);
  const failed = events.some((event) => event.entry.failed === true);
  const turnId = encodeURIComponent(turn.key);
  return (
    <section
      className={cx(
        "niceeval-trace-turn",
        turn.verdict && `niceeval-trace-turn--${turn.verdict}`,
        failed && "niceeval-trace-turn--failed-events",
      )}
      data-niceeval-trace-turn={turnId}
    >
      <header className="niceeval-trace-turn-head niceeval-conversation-turn-head">
        <button
          type="button"
          className="niceeval-trace-turn-toggle"
          data-niceeval-trace-turn-toggle={turnId}
          aria-expanded="true"
          title={text(locale, "Collapse turn", "折叠轮次")}
        >
          <span className="niceeval-trace-turn-chevron" aria-hidden="true">⌄</span>
          <span className="niceeval-trace-turn-label">{resolveLocalizedText(turn.label, locale)}</span>
          <span className="niceeval-trace-turn-facts">
            {duration === undefined ? text(locale, "timing unavailable", "时长不可用") : durationLabel(duration)}
            <span>{events.length} {text(locale, "events", "事件")}</span>
            {calls > 0 ? <span>{calls} {text(locale, "calls", "调用")}</span> : null}
          </span>
          {turn.verdict ? <span className="niceeval-trace-turn-verdict">{turn.verdict}</span> : null}
        </button>
      </header>
      <div className="niceeval-trace-turn-events">
        {events.length === 0 ? (
          <p className="niceeval-trace-empty-turn">{text(locale, "No events captured for this turn.", "此轮没有已捕获事件。")}</p>
        ) : events.map((event) => <TraceEventRow key={event.id} event={event} locale={locale} />)}
      </div>
    </section>
  );
}

export const TurnTrace = defineComponent<TurnTraceProps, ResolvedTurnTraceProps>({
  dimensions: () => ({}),
  resolve(props) {
    return {
      data: props.data ?? null,
      locale: props.locale,
      className: props.className,
    };
  },
  web({ data, locale, className }, ctx) {
    if (data === null || data.turns.length === 0) return null;
    const loc = locale ?? ctx.locale;
    const events = traceEventsOf(data, loc);
    return (
      <section
        className={cx("niceeval-report", "niceeval-turn-trace", className)}
        data-niceeval-turn-trace
        data-niceeval-duration-mode="sequence"
      >
        <TraceToolbar content={data} events={events} locale={loc} />
        <TraceTimeline content={data} events={events} locale={loc} />
        <div className="niceeval-trace-ledger" data-niceeval-trace-ledger>
          {data.turns.map((turn, turnIndex) => (
            <TraceTurn
              key={turn.key}
              turn={turn}
              events={events.filter((event) => event.turnIndex === turnIndex)}
              locale={loc}
            />
          ))}
        </div>
      </section>
    );
  },
  text({ data, locale }, ctx) {
    return data === null || data.turns.length === 0
      ? ""
      : conversationText(data, ctx, locale ?? ctx.locale);
  },
});

TurnTrace.displayName = "TurnTrace";
