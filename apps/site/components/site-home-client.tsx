"use client";

import { useEffect, useState } from "react";
import { BookOpen, Clipboard, GitFork } from "lucide-react";
import { initAnalytics, track } from "../src/analytics";
import { githubUrl, docsUrl, withLocale, type Dictionary, type Locale } from "../lib/content";
import { Header } from "./site-header";
import TerminalDemo from "./site-home-terminal";
import Link from "next/link";
import dynamic from "next/dynamic";

// Setup 是首页最重的区块(prism 高亮 + 示例数据),拆成独立 chunk 异步 hydrate,
// 把它的 JS 挪出 LCP 关键路径;SSR 照常输出,不影响 SEO 文本。
const Setup = dynamic(() => import("./site-home-setup"));
// AgentLoop 同样在首屏之外,跟着 Setup 的思路拆出关键路径。
const AgentLoop = dynamic(() => import("./site-home-agent-loop"));
// Agent 侧的终端只有切到「给 Agent」才会挂,首屏默认那套仍走静态 import;
// 分包加载期间用等高占位撑住这一格。
const AgentTerminalDemo = dynamic(() => import("./site-home-agent-terminal"), {
  loading: () => <div className="term" />,
});

type AudienceMode = "humans" | "agents";

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
        <AgentLoop t={t} locale={locale} />
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

      {/* 屏幕跟着受众切:给人看的是 CLI 自己的人读面,给 Agent 看的是 Claude Code 驱动同一套命令。 */}
      {mode === "humans" ? (
        <TerminalDemo ariaLabel={t.visualLabel} replayLabel={t.replay} />
      ) : (
        <AgentTerminalDemo ariaLabel={t.visualLabelAgents} replayLabel={t.replay} />
      )}
    </section>
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
