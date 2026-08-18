"use client";

import React, { type KeyboardEvent, useMemo, useState } from "react";
import { Highlight, themes } from "prism-react-renderer";
import { CheckCircle2, ChevronRight, MessageCircle } from "lucide-react";
import { track } from "../src/analytics";
import { evalExamples, type EvalExample, type EvalExampleTrace } from "../src/eval-examples";
import type { Dictionary, Locale } from "../lib/content";

const codeTheme = {
  ...themes.vsDark,
  plain: { ...themes.vsDark.plain, backgroundColor: "transparent" },
};

// 首页最重的区块(prism 高亮 + 示例数据),独立成 chunk 由 next/dynamic 加载,
// 不占首屏 LCP 的启动 JS 关键路径。
export default function Setup({ t, locale }: { t: Dictionary; locale: Locale }) {
  const [activeId, setActiveId] = useState(evalExamples[0].id);
  const activeExample = evalExamples.find((example) => example.id === activeId) ?? evalExamples[0];

  const activate = (id: string) => {
    if (id === activeId) return;
    track("Switch Eval Example", { id, source: "switcher", locale });
    setActiveId(id);
  };

  return (
    <section id="setup" className="setup shell">
      <div className="setup-intro">
        <p className="eyebrow">{t.setupEyebrow}</p>
        <h2>{t.setupTitle}</h2>
        <p className="setup-caption">{t.setupCaption}</p>
        <div className="deck-switch" role="tablist" aria-label={t.setupEyebrow}>
          {evalExamples.map((example) => (
            <button
              key={example.id}
              type="button"
              role="tab"
              aria-selected={example.id === activeId}
              className={example.id === activeId ? "active" : undefined}
              onClick={() => activate(example.id)}
            >
              <span className="deck-tag">{example[locale].tag}</span>
              <span>{example[locale].label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="eval-deck" role="tabpanel">
        <EvalCard key={activeExample.id} t={t} example={activeExample} locale={locale} />
      </div>
    </section>
  );
}

function EvalCard({
  t,
  example,
  locale,
}: {
  t: Dictionary;
  example: EvalExample;
  locale: Locale;
}) {
  const [openLines, setOpenLines] = useState<Set<number>>(() => new Set());
  const [timingOpen, setTimingOpen] = useState(false);
  const card = example[locale];
  const meta = example.meta;

  const toggleLine = (lineNo: number, noteKey: string) => {
    setOpenLines((prev) => {
      const next = new Set(prev);
      const opening = !next.has(lineNo);
      if (opening) next.add(lineNo);
      else next.delete(lineNo);
      track("Toggle Eval Code Note", { example: example.id, noteKey, open: opening });
      return next;
    });
  };

  return (
    <div className="setup-card">
      <div className="setup-card-head">
        <div className="setup-card-title">
          <span className="deck-tag">{card.tag}</span>
          <span className="deck-label">{card.label}</span>
        </div>
        <span className="run-status">
          <CheckCircle2 size={13} />
          {t.runStatusPassed}
        </span>
      </div>
      <div className="setup-panel">
        <Highlight code={card.lines.join("\n")} language="tsx" theme={codeTheme}>
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <pre className={`eval-code ${className}`} style={style}>
              {tokens.map((line, i) => {
                const lineNo = i + 1;
                const noteKey = meta.highlights[lineNo];
                const isReply = noteKey ? meta.replyKeys.includes(noteKey) : false;
                const open = openLines.has(lineNo);
                const lineClassName = noteKey ? `code-line interactive ${isReply ? "reply" : "assertion"}` : "code-line";
                return (
                  <React.Fragment key={lineNo}>
                    <div
                      {...getLineProps({ line, className: lineClassName })}
                      role={noteKey ? "button" : undefined}
                      tabIndex={noteKey ? 0 : undefined}
                      aria-expanded={noteKey ? open : undefined}
                      onClick={noteKey ? () => toggleLine(lineNo, noteKey) : undefined}
                      onKeyDown={
                        noteKey
                          ? (event: KeyboardEvent<HTMLDivElement>) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                toggleLine(lineNo, noteKey);
                              }
                            }
                          : undefined
                      }
                    >
                      <span className="code-line-no">
                        {noteKey ? isReply ? <MessageCircle size={12} /> : <CheckCircle2 size={12} /> : lineNo}
                      </span>
                      <span className="code-line-content">
                        {line.map((token, tokenIndex) => (
                          <span key={tokenIndex} {...getTokenProps({ token })} />
                        ))}
                      </span>
                      {noteKey ? (
                        <span className="code-line-actions">
                          {lineNo === meta.gateLine ? <span className="gate-badge">{meta.gateBadge}</span> : null}
                          <ChevronRight size={12} className={open ? "chev open" : "chev"} aria-hidden="true" />
                        </span>
                      ) : null}
                    </div>
                    {noteKey && open ? (
                      isReply ? (
                        <div className="code-note code-note-trace">
                          <ExampleSessionTrace trace={card.traces[noteKey]} locale={locale} />
                        </div>
                      ) : (
                        <div className="code-note">
                          <CheckCircle2 size={13} />
                          <span>{card.notes[noteKey]}</span>
                        </div>
                      )
                    ) : null}
                  </React.Fragment>
                );
              })}
            </pre>
          )}
        </Highlight>
      </div>
      <button
        type="button"
        className="eval-more"
        aria-expanded={timingOpen}
        onClick={() =>
          setTimingOpen((v) => {
            track("Toggle Timing Trace", { example: example.id, open: !v });
            return !v;
          })
        }
      >
        <ChevronRight size={13} className={timingOpen ? "chev open" : "chev"} />
        {t.timingLabel}
      </button>
      {timingOpen ? (
        <div className="eval-more-body">
          <ul className="eval-timing">
            {card.timingRows.map((row) => (
              <li key={row.label}>
                <span>{row.label}</span>
                <b>{row.value}</b>
              </li>
            ))}
          </ul>
          <p className="eval-timing-total">{card.timingTotal}</p>
        </div>
      ) : null}
    </div>
  );
}

function ExampleSessionTrace({ trace, locale }: { trace: EvalExampleTrace; locale: Locale }) {
  const [turnOpen, setTurnOpen] = useState(true);
  const [callsOpen, setCallsOpen] = useState(true);
  const [query, setQuery] = useState("");
  const calls = trace.calls;
  const visibleEvents = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale === "zh" ? "zh-CN" : "en");
    return trace.events.filter((event) => {
      if (!callsOpen && event.tool) return false;
      return normalized.length === 0 || `${event.kind} ${event.summary} ${event.status}`.toLocaleLowerCase().includes(normalized);
    });
  }, [callsOpen, locale, query, trace.events]);
  const copy = locale === "zh"
    ? { title: "会话日志", duration: "时长", turns: "轮次", calls: "调用", search: "搜索", input: "输入 / 用户", model: "模型 / 助手", tools: "工具 / 工具", turn: "Turn 1", events: "事件", note: "时长模式投影已捕获的轮次时长；没有逐事件时间戳时，事件在轮次内保持等宽顺序。" }
    : { title: "Session log", duration: "Duration", turns: "Turns", calls: "Calls", search: "Search", input: "Input / User", model: "Model / Assistant", tools: "Tools / Tool", turn: "Turn 1", events: "events", note: "Duration projects captured turn duration; without per-event timestamps, events remain evenly sequenced within the turn." };

  return (
    <section className="site-trace" aria-label={copy.title}>
      <header className="site-trace-toolbar">
        <div className="site-trace-toolbar-main">
          <strong>{copy.title}</strong>
          <span>{copy.duration} <b>{trace.duration}</b></span>
          <button type="button" aria-pressed={!turnOpen} onClick={() => setTurnOpen((open) => !open)}>⊟ {copy.turns} <b>1</b></button>
          <button type="button" aria-pressed={!callsOpen} disabled={calls === 0} onClick={() => setCallsOpen((open) => !open)}>⊟ {copy.calls} <b>{calls}</b></button>
        </div>
        <label className="site-trace-search">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">{copy.search}</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder={copy.search} />
        </label>
      </header>
      <div className="site-trace-timeline">
        <div className="site-trace-labels" aria-hidden="true"><span>{copy.input}</span><span>{copy.model}</span><span>{copy.tools}</span></div>
        <div className="site-trace-track" style={{ "--trace-columns": trace.events.length } as React.CSSProperties}>
          {trace.events.map((event, index) => <span key={`${event.kind}-${index}`} data-lane={event.lane} style={{ "--trace-column": index + 1 } as React.CSSProperties} />)}
        </div>
        <p>{copy.note}</p>
      </div>
      <div className="site-trace-turn">
        <button type="button" className="site-trace-turn-head" aria-expanded={turnOpen} onClick={() => setTurnOpen((open) => !open)}>
          <span className={turnOpen ? "site-trace-chevron open" : "site-trace-chevron"}>›</span>
          <strong>{copy.turn}</strong>
          <span>{trace.duration}</span>
          <span>{trace.events.length} {copy.events}</span>
          {calls > 0 ? <span>{calls} {copy.calls.toLocaleLowerCase()}</span> : null}
        </button>
        {turnOpen ? (
          <div className="site-trace-events">
            {visibleEvents.map((event, index) => (
              <div key={`${event.kind}-${index}`} className={event.tool ? "site-trace-event tool" : "site-trace-event"}>
                <span data-lane={event.lane}>{event.kind}</span>
                <p>{event.summary}</p>
                <time>{trace.duration}</time>
                <em>{event.status}</em>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
