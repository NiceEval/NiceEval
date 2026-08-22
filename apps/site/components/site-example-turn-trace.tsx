"use client";

import React, { useMemo, useState } from "react";
import type { Locale } from "../lib/content";
import type { EvalExampleTrace, EvalExampleTraceEvent } from "../src/eval-examples";

type TraceStyle = React.CSSProperties & Record<`--niceeval-trace-${string}`, string>;

function traceStyle(index: number, total: number, lane: EvalExampleTraceEvent["lane"]): TraceStyle {
  const left = index / total * 100;
  const width = 100 / total;
  return {
    "--niceeval-trace-sequence-left": `${left}%`,
    "--niceeval-trace-sequence-width": `${width}%`,
    "--niceeval-trace-duration-left": `${left}%`,
    "--niceeval-trace-duration-width": `${width}%`,
    "--niceeval-trace-lane": lane === "input" ? "0" : lane === "model" ? "1" : "2",
  };
}

export default function ExampleTurnTrace({ trace, locale }: { trace: EvalExampleTrace; locale: Locale }) {
  const [durationMode, setDurationMode] = useState(false);
  const [turnOpen, setTurnOpen] = useState(true);
  const [callsOpen, setCallsOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [evidenceTab, setEvidenceTab] = useState<"preview" | "raw">("preview");
  const zh = locale === "zh";
  const normalizedQuery = query.trim().toLocaleLowerCase(zh ? "zh-CN" : "en");
  const matches = useMemo(() => trace.events.map((event) => (
    normalizedQuery.length === 0
    || `${event.kind} ${event.summary} ${event.status} ${event.raw ?? ""}`.toLocaleLowerCase().includes(normalizedQuery)
  )), [normalizedQuery, trace.events]);
  const eventId = (index: number) => `turn-1:${index}`;

  const chooseEvent = (index: number, reveal = false) => {
    setSelected((current) => current === index ? null : index);
    setEvidenceTab("preview");
    setTurnOpen(true);
    if (reveal) {
      requestAnimationFrame(() => {
        document.querySelector(`[data-site-trace-row="${eventId(index)}"]`)?.scrollIntoView({ block: "nearest" });
      });
    }
  };

  return (
    <div className="niceeval-js site-example-trace" onKeyDown={(event) => {
      if (event.key === "Escape") setSelected(null);
    }}>
      <section
        className="niceeval-report niceeval-turn-trace"
        data-niceeval-turn-trace
        data-niceeval-duration-mode={durationMode ? "duration" : "sequence"}
        data-calls-collapsed={callsOpen ? "false" : "true"}
      >
        <header className="niceeval-trace-toolbar" role="toolbar" aria-label={zh ? "轨迹控制" : "Trajectory controls"}>
          <div className="niceeval-trace-toolbar-main">
            <span className="niceeval-trace-toolbar-title">{zh ? "会话日志" : "Session log"}</span>
            <div className="niceeval-trace-toolbar-actions">
              <button
                type="button"
                className="niceeval-trace-toolbar-button niceeval-trace-toolbar-button--duration"
                data-niceeval-trace-duration
                aria-pressed={durationMode}
                title={zh ? "按轮次时长投影" : "Use turn-duration projection"}
                onClick={() => setDurationMode((active) => !active)}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.25" /><path d="M8 4.75V8l2.25 1.5" /></svg>
                <span>{zh ? "时长" : "Duration"}</span>
                <b>{trace.duration}</b>
              </button>
              <button
                type="button"
                className="niceeval-trace-toolbar-button"
                data-niceeval-trace-turns
                aria-pressed={!turnOpen}
                title={turnOpen ? (zh ? "折叠轮次" : "Collapse turns") : (zh ? "展开轮次" : "Expand turns")}
                onClick={() => setTurnOpen((open) => !open)}
              >
                <span className="niceeval-trace-toolbar-glyph" aria-hidden="true">{turnOpen ? "⊟" : "⊞"}</span>
                <span>{zh ? "轮次" : "Turns"}</span>
                <b>1</b>
              </button>
              <button
                type="button"
                className="niceeval-trace-toolbar-button"
                data-niceeval-trace-calls
                aria-pressed={!callsOpen}
                title={callsOpen ? (zh ? "折叠工具调用" : "Collapse tool calls") : (zh ? "展开工具调用" : "Expand tool calls")}
                disabled={trace.calls === 0}
                onClick={() => setCallsOpen((open) => !open)}
              >
                <span className="niceeval-trace-toolbar-glyph" aria-hidden="true">{callsOpen ? "⊟" : "⊞"}</span>
                <span>{zh ? "调用" : "Calls"}</span>
                <b>{trace.calls}</b>
              </button>
            </div>
          </div>
          <label className="niceeval-trace-search">
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.25" /><path d="m10.25 10.25 3 3" /></svg>
            <span className="niceeval-trace-visually-hidden">{zh ? "搜索轨迹" : "Search trajectory"}</span>
            <input
              type="search"
              data-niceeval-trace-search
              placeholder={zh ? "搜索" : "Search"}
              aria-label={zh ? "搜索轨迹" : "Search trajectory"}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </header>

        <section className="niceeval-trace-timeline" aria-label={zh ? "轨迹时间线" : "Trajectory timeline"} data-niceeval-trace-timeline data-timing-complete="true">
          <div className="niceeval-trace-timeline-plot">
            <div className="niceeval-trace-timeline-labels" aria-hidden="true">
              <span>{zh ? "输入 / 用户" : "Input / User"}</span>
              <span>{zh ? "模型 / 助手" : "Model / Assistant"}</span>
              <span>{zh ? "工具 / 工具" : "Tools / Tool"}</span>
            </div>
            <div className="niceeval-trace-timeline-track">
              <span className="niceeval-trace-timeline-boundary" aria-hidden="true" style={traceStyle(0, trace.events.length, trace.events[0]?.lane ?? "input")} />
              {trace.events.map((event, index) => (
                <button
                  key={eventId(index)}
                  type="button"
                  className="niceeval-trace-timeline-span"
                  data-niceeval-trace-timeline-event={eventId(index)}
                  data-lane={event.lane}
                  data-search-match={normalizedQuery ? (matches[index] ? "true" : "false") : undefined}
                  aria-pressed={selected === index}
                  aria-label={`${event.kind} · Turn 1 · ${trace.duration}`}
                  title={`${event.kind} · Turn 1 · ${trace.duration}`}
                  style={traceStyle(index, trace.events.length, event.lane)}
                  onClick={() => chooseEvent(index, true)}
                />
              ))}
            </div>
          </div>
          <p className="niceeval-trace-timeline-note">
            {zh
              ? "时长模式投影已捕获的轮次时长；没有逐事件时间戳时，事件在轮次内保持等宽顺序。"
              : "Duration projects captured turn durations; without per-event timestamps, events remain evenly sequenced within each turn."}
          </p>
        </section>

        <div className="niceeval-trace-ledger" data-niceeval-trace-ledger>
          <section
            className="niceeval-trace-turn"
            data-niceeval-trace-turn="turn-1"
            data-collapsed={turnOpen ? "false" : "true"}
            data-search-active={normalizedQuery ? "true" : undefined}
            data-search-empty={matches.some(Boolean) ? "false" : "true"}
          >
            <header className="niceeval-trace-turn-head niceeval-conversation-turn-head">
              <button
                type="button"
                className="niceeval-trace-turn-toggle"
                data-niceeval-trace-turn-toggle="turn-1"
                aria-expanded={turnOpen}
                title={turnOpen ? (zh ? "折叠轮次" : "Collapse turn") : (zh ? "展开轮次" : "Expand turn")}
                onClick={() => setTurnOpen((open) => !open)}
              >
                <span className="niceeval-trace-turn-chevron" aria-hidden="true">⌄</span>
                <span className="niceeval-trace-turn-label">Turn 1</span>
                <span className="niceeval-trace-turn-facts">
                  {trace.duration}
                  <span>{trace.events.length} {zh ? "事件" : "events"}</span>
                  {trace.calls > 0 ? <span>{trace.calls} {zh ? "调用" : "calls"}</span> : null}
                </span>
              </button>
            </header>
            <div className="niceeval-trace-turn-events">
              {trace.events.map((event, index) => (
                <TraceEventRow
                  key={eventId(index)}
                  event={event}
                  eventId={eventId(index)}
                  duration={trace.duration}
                  locale={locale}
                  searchActive={normalizedQuery.length > 0}
                  hidden={!matches[index]}
                  selected={selected === index}
                  evidenceTab={evidenceTab}
                  onSelect={() => chooseEvent(index)}
                  onEvidenceTab={setEvidenceTab}
                />
              ))}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function TraceEventRow({
  event,
  eventId,
  duration,
  locale,
  searchActive,
  hidden,
  selected,
  evidenceTab,
  onSelect,
  onEvidenceTab,
}: {
  event: EvalExampleTraceEvent;
  eventId: string;
  duration: string;
  locale: Locale;
  searchActive: boolean;
  hidden: boolean;
  selected: boolean;
  evidenceTab: "preview" | "raw";
  onSelect: () => void;
  onEvidenceTab: (tab: "preview" | "raw") => void;
}) {
  const zh = locale === "zh";
  return (
    <article
      className={`niceeval-trace-event-row${event.tool ? " niceeval-trace-event-row--tool" : ""}${hidden ? " niceeval-row-hidden" : ""}`}
      data-niceeval-trace-event={eventId}
      data-site-trace-row={eventId}
      data-tool-row={event.tool ? "true" : undefined}
      data-search-match={searchActive ? (hidden ? "false" : "true") : undefined}
    >
      <span className="niceeval-trace-event-turn-rail" aria-hidden="true" />
      <button
        type="button"
        className="niceeval-trace-event-select"
        data-niceeval-trace-select={eventId}
        aria-pressed={selected}
        aria-expanded={selected}
        aria-label={`${event.kind}: ${event.summary}`}
        onClick={onSelect}
      >
        <span className="niceeval-trace-event-kind" data-lane={event.lane}>{event.kind}</span>
        <span className="niceeval-trace-event-summary">{event.summary}</span>
        <span className="niceeval-trace-event-meta" title={`Turn 1 · ${duration}`}>{duration}</span>
        <span className="niceeval-trace-event-status">{event.status}</span>
      </button>
      <details className="niceeval-trace-evidence" data-niceeval-trace-evidence={eventId} open={selected}>
        <summary>{zh ? "证据" : "Evidence"}</summary>
        <div className="niceeval-trace-evidence-body">
          <dl className="niceeval-trace-evidence-meta">
            <div><dt>{zh ? "来源" : "Source"}</dt><dd>Turn 1</dd></div>
            <div><dt>{zh ? "状态" : "Status"}</dt><dd>{event.status}</dd></div>
            <div><dt>{zh ? "总时长" : "Total duration"}</dt><dd>{duration}</dd></div>
            {event.callPhase ? <div><dt>{zh ? "调用阶段" : "Call phase"}</dt><dd>{event.callPhase}</dd></div> : null}
            {event.callId ? <div><dt>{zh ? "调用 ID" : "Call ID"}</dt><dd>{event.callId}</dd></div> : null}
          </dl>
          <div className="niceeval-trace-evidence-tabs" role="tablist" aria-label={zh ? "记录详情标签" : "Record detail tabs"}>
            <button type="button" role="tab" data-niceeval-trace-evidence-tab="preview" aria-selected={evidenceTab === "preview"} onClick={() => onEvidenceTab("preview")}>{zh ? "预览" : "Preview"}</button>
            <button type="button" role="tab" data-niceeval-trace-evidence-tab="raw" aria-selected={evidenceTab === "raw"} onClick={() => onEvidenceTab("raw")}>{zh ? "原始" : "Raw"}</button>
          </div>
          <section className="niceeval-trace-evidence-panel" data-niceeval-trace-evidence-panel="preview" role="tabpanel" aria-label={zh ? "预览" : "Preview"} data-active={evidenceTab === "preview" ? "true" : "false"}>
            <h4>{zh ? "预览" : "Preview"}</h4>
            <p className="niceeval-text">{event.detail ?? event.summary}</p>
          </section>
          <section className="niceeval-trace-evidence-panel" data-niceeval-trace-evidence-panel="raw" role="tabpanel" aria-label={zh ? "原始" : "Raw"} data-active={evidenceTab === "raw" ? "true" : "false"}>
            <h4>{zh ? "原始" : "Raw"}</h4>
            <pre className="niceeval-trace-evidence-raw">{event.raw ?? event.summary}</pre>
          </section>
        </div>
      </details>
    </article>
  );
}
