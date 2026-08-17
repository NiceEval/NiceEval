// TurnTrace: one-send trajectory view. The report is server-rendered; the
// optional inspector is progressively enhanced by report/assets/enhance.js.

import type { ReactElement } from "react";
import { defineComponent } from "../tree.ts";
import {
  Conversation,
  type ConversationContent,
  type ConversationTurn,
} from "./conversation.tsx";
import type { ReportLocale } from "../../model/locale.ts";
import type { ValueProps } from "./shared.ts";

export type TurnTraceProps = ValueProps<
  ConversationContent | null,
  { locale?: ReportLocale; className?: string }
>;

function durationLabel(durationMs: number | undefined): string {
  if (durationMs === undefined) return "timing unavailable";
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`;
  const seconds = Math.round(durationMs / 1_000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function turnDuration(turn: ConversationTurn): number | undefined {
  return turn.durationMs !== undefined && Number.isFinite(turn.durationMs)
    ? Math.max(0, turn.durationMs)
    : undefined;
}

function renderTimeline(turns: readonly ConversationTurn[]): ReactElement {
  const durations = turns.map(turnDuration);
  const knownTotal = durations.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const fallbackWidth = turns.length === 0 ? 0 : 100 / turns.length;
  return (
    <div className="niceeval-turn-trace-timeline" aria-label="Turn timeline">
      <div className="niceeval-turn-trace-timeline-axis">
        {turns.map((turn, index) => {
          const duration = durations[index];
          const width = knownTotal > 0 && duration !== undefined
            ? Math.max(4, (duration / knownTotal) * 100)
            : fallbackWidth;
          return (
            <div
              key={turn.key}
              className="niceeval-turn-trace-span"
              style={{ width: `${width}%` }}
              data-turn-key={turn.key}
              title={`Turn ${index + 1} · ${durationLabel(duration)}`}
            />
          );
        })}
      </div>
      <div className="niceeval-turn-trace-timeline-labels">
        <span>Input</span><span>Model</span><span>Tools</span>
      </div>
    </div>
  );
}

export const TurnTrace = defineComponent<TurnTraceProps>(async (props) => {
  const data = props.data ?? null;
  if (data === null || data.turns.length === 0) return null;
  return (
    <section className={`niceeval-report niceeval-turn-trace ${props.className ?? ""}`} data-niceeval-turn-trace>
      {renderTimeline(data.turns)}
      <div className="niceeval-turn-trace-body">
        <Conversation
          data={data}
          locale={props.locale}
          title={{ en: "Turn trace", "zh-CN": "Turn 轨迹" }}
        />
        <aside className="niceeval-turn-trace-inspector" data-niceeval-turn-inspector hidden>
          <header className="niceeval-turn-trace-inspector-head">
            <div>
              <span className="niceeval-turn-trace-inspector-kicker">Selected event</span>
              <h3 data-niceeval-turn-inspector-title>Event details</h3>
            </div>
            <button type="button" data-niceeval-turn-inspector-close aria-label="Close event details">×</button>
          </header>
          <div className="niceeval-turn-trace-inspector-body" data-niceeval-turn-inspector-body>
            Select an event to inspect its captured evidence.
          </div>
        </aside>
      </div>
    </section>
  );
});

TurnTrace.displayName = "TurnTrace";
