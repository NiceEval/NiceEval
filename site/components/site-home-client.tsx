"use client";

import React, { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Highlight, themes } from "prism-react-renderer";
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  FileCode2,
  Folder,
  GitCompare,
  GitFork,
  MessageCircle,
  Play,
  Terminal,
  Wrench,
} from "lucide-react";
import { initAnalytics, track } from "../src/analytics";
import { evalExamples, type EvalExample } from "../src/eval-examples";
import { compareCard, fileTree, githubUrl, docsUrl, withLocale, type Dictionary, type FileTreeItem, type Locale } from "../lib/content";
import { Header } from "./site-header";
import Link from "next/link";

type AudienceMode = "humans" | "agents";

function fileIcon(item: FileTreeItem) {
  if (item.kind === "folder") return <Folder size={14} />;
  if (item.path.endsWith("config.ts")) return <Wrench size={14} />;
  if (item.path.endsWith(".json")) return <Terminal size={14} />;
  return <FileCode2 size={14} />;
}

const codeTheme = {
  ...themes.vsDark,
  plain: { ...themes.vsDark.plain, backgroundColor: "transparent" },
};

export default function HomeClient({ t, locale }: { t: Dictionary; locale: Locale }) {
  useEffect(() => {
    initAnalytics();
    if (process.env.NODE_ENV === "development") {
      import("react-grab");
    }
  }, []);

  return (
    <>
      <Header locale={locale} t={t} route={{ name: "home" }} />
      <main>
        <Hero t={t} locale={locale} />
        <Strip t={t} />
        <Setup t={t} locale={locale} />
      </main>
    </>
  );
}

function Hero({ t, locale }: { t: Dictionary; locale: Locale }) {
  const [mode, setMode] = useState<AudienceMode>("humans");
  const [copied, setCopied] = useState(false);
  const active = t.modes[mode];
  const agentMode = t.modes.agents;
  const humanMode = t.modes.humans;
  const copyCommand = async () => {
    try {
      await navigator.clipboard?.writeText(agentMode.command);
    } catch {
      // Some browsers block clipboard access outside secure contexts.
    }
    track("Copy Init Command", { locale });
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <section id="top" className="hero shell">
      <div className="hero-copy">
        <div className="logo-lines" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <h1>{t.heroTitle}</h1>
        <div className="mode-switch" aria-label="Audience">
          {(Object.entries(t.modes) as Array<[AudienceMode, (typeof t.modes)[AudienceMode]]>).map(([key, item]) => (
            <button
              key={key}
              type="button"
              className={key === mode ? "active" : ""}
              onClick={() => {
                track("Switch Audience Mode", { mode: key, locale });
                setMode(key);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        {mode === "humans" ? (
          <a
            className="button primary docs-cta"
            href={docsUrl[locale]}
            target="_blank"
            rel="noreferrer"
            onClick={() => track("Click Docs Link", { location: "hero", locale })}
          >
            <BookOpen size={16} />
            {humanMode.cta}
          </a>
        ) : (
          <div className="copy-row">
            <code>{agentMode.command}</code>
            <button type="button" aria-label={t.copyCommand} onClick={copyCommand}>
              <Clipboard size={16} />
            </button>
            <span className={copied ? "copy-status visible" : "copy-status"}>{t.copied}</span>
          </div>
        )}
        <p className="lede">{active.caption}</p>
        <div className="actions">
          <a className="button primary" href="#setup" onClick={() => track("Click Primary CTA", { mode, locale })}>
            <Play size={15} />
            {t.primaryAction}
          </a>
          <a className="button ghost" href={githubUrl} onClick={() => track("Click GitHub Link", { location: "hero" })}>
            <GitFork size={15} />
            {t.github}
          </a>
          <Link
            className="button ghost"
            href={withLocale(locale, "blog")}
            onClick={() => track("Click Blog Link", { location: "hero", locale })}
          >
            <BookOpen size={15} />
            {t.blog}
          </Link>
        </div>
      </div>

      <ProductVisual mode={mode} t={t} />
    </section>
  );
}

function ProductVisual({ mode, t }: { mode: AudienceMode; t: Dictionary }) {
  return (
    <div className="visual" aria-label={t.visualLabel}>
      <div className="wire a" />
      <div className="wire b" />
      <div className="wire c" />
      <div className="file-card">
        <div className="card-head">
          <Folder size={18} />
          <span>{t.fileCardRoot}</span>
        </div>
        <ul>
          {fileTree[mode].map((item) => (
            <li key={item.path} className={item.depth ? "indent" : undefined}>
              {fileIcon(item)}
              <span>{item.path}</span>
              {item.note ? <em>{t.fileNotes[item.note]}</em> : null}
            </li>
          ))}
        </ul>
      </div>
      <div className="run-card">
        <code>$ niceeval</code>
        <div className="run-line">
          <CheckCircle2 size={16} />
          <span>weather</span>
          <b>{t.runStatusPassed}</b>
        </div>
        <div className="run-line">
          <CheckCircle2 size={16} />
          <span>fixtures/button</span>
          <b>91.7%</b>
        </div>
      </div>
      <div className="score-card">
        <div className="compare-head">
          <GitCompare size={14} />
          <span>{compareCard.group}</span>
        </div>
        <ul className="compare-rows">
          {compareCard.rows.map((row) => (
            <li key={row.name} className={row.score < 90 ? "warn" : undefined}>
              <div className="compare-row-top">
                <span>{row.name}</span>
                <b>{row.score}%</b>
              </div>
              <div className="compare-bar">
                <i style={{ width: `${row.score}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Strip({ t }: { t: Dictionary }) {
  return (
    <section className="strip shell" aria-label={t.workflowLabel}>
      {t.steps.map(([title, text], index) => (
        <Step key={title} k={String(index + 1)} title={title} text={text} />
      ))}
    </section>
  );
}

function Step({ k, title, text }: { k: string; title: string; text: string }) {
  return (
    <article>
      <span>{k}</span>
      <h2>{title}</h2>
      <p>{text}</p>
    </article>
  );
}

function Setup({ t, locale }: { t: Dictionary; locale: Locale }) {
  const [activeId, setActiveId] = useState(evalExamples[0].id);
  // 自动轮播:进入视口才转,悬停在卡组上暂停;用户任何点击不停止轮播,只把倒计时清零重来。
  const [resetKey, setResetKey] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [inView, setInView] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  const activeIndex = evalExamples.findIndex((example) => example.id === activeId);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.35 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (hovering || !inView) return undefined;
    const timer = window.setInterval(() => {
      setActiveId((prev) => {
        const index = evalExamples.findIndex((example) => example.id === prev);
        return evalExamples[(index + 1) % evalExamples.length].id;
      });
    }, 6500);
    return () => window.clearInterval(timer);
  }, [hovering, inView, resetKey]);

  const activate = (id: string, source: "switcher" | "card") => {
    setResetKey((key) => key + 1);
    if (id === activeId) return;
    track("Switch Eval Example", { id, source, locale });
    setActiveId(id);
  };

  return (
    <section id="setup" className="setup shell" ref={sectionRef}>
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
              onClick={() => activate(example.id, "switcher")}
            >
              <span className="deck-tag">{example[locale].tag}</span>
              <span>{example[locale].label}</span>
            </button>
          ))}
        </div>
      </div>
      <div
        className="eval-deck"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onClickCapture={() => setResetKey((key) => key + 1)}
      >
        {evalExamples.map((example, index) => (
          <EvalCard
            key={example.id}
            t={t}
            example={example}
            locale={locale}
            active={example.id === activeId}
            offset={(index - activeIndex + evalExamples.length) % evalExamples.length}
            onActivate={() => activate(example.id, "card")}
          />
        ))}
      </div>
    </section>
  );
}

function EvalCard({
  t,
  example,
  locale,
  active,
  offset,
  onActivate,
}: {
  t: Dictionary;
  example: EvalExample;
  locale: Locale;
  active: boolean;
  offset: number;
  onActivate: () => void;
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
    // 后排卡片只当"切换到这个示例"的按钮用:整卡可点,内容对读屏和 Tab 键隐藏(键盘走左侧 tablist)。
    <div
      className={active ? "setup-card deck-card active" : `setup-card deck-card deck-pos-${offset}`}
      aria-hidden={active ? undefined : true}
      onClick={active ? undefined : onActivate}
    >
      <div className="setup-card-head">
        <div className="setup-card-title">
          <span className="deck-tag">{card.tag}</span>
          <span className="deck-label">{card.label}</span>
        </div>
        <span className="pill">{t.runStatusPassed}</span>
      </div>
      <div className="setup-panel">
        <Highlight code={card.lines.join("\n")} language="tsx" theme={codeTheme}>
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <pre className={`eval-code ${className}`} style={style}>
              {tokens.map((line, i) => {
                const lineNo = i + 1;
                const noteKey = active ? meta.highlights[lineNo] : undefined;
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
        tabIndex={active ? undefined : -1}
        onClick={
          active
            ? () =>
                setTimingOpen((v) => {
                  track("Toggle Timing Trace", { example: example.id, open: !v });
                  return !v;
                })
            : undefined
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
