"use client";

import React, { type KeyboardEvent, useState } from "react";
import { Highlight, themes } from "prism-react-renderer";
import { CheckCircle2, ChevronRight, MessageCircle } from "lucide-react";
import { track } from "../src/analytics";
import { evalExamples, type EvalExample } from "../src/eval-examples";
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
                      <div className={`code-note ${isReply ? "code-note-reply" : ""}`}>
                        {isReply ? <span className="code-note-role">assistant</span> : <CheckCircle2 size={13} />}
                        <span>{card.notes[noteKey]}</span>
                      </div>
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
