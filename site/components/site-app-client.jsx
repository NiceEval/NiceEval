"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Highlight, themes } from "prism-react-renderer";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
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
import { evalExamples } from "../src/eval-examples";

const githubUrl = "https://github.com/CorrectRoadH/niceeval";
const blogPath = "/blog";

// 文档站按语言分入口：en 是默认语言走根路径，zh 走 /zh 前缀。
const docsUrl = {
  en: "https://niceeval.com/docs/quickstart",
  zh: "https://niceeval.com/docs/zh/quickstart",
};

const initPrompt =
  "READ https://raw.githubusercontent.com/CorrectRoadH/niceeval/refs/heads/main/INIT.md and install niceeval for this repo.";

const fileTree = {
  humans: [
    { path: "agents/web-agent.ts", depth: 0, kind: "file", note: "adapter" },
    { path: "evals/", depth: 0, kind: "folder" },
    { path: "weather-tool.eval.ts", depth: 1, kind: "file" },
    { path: "image-understanding.eval.ts", depth: 1, kind: "file" },
    { path: "experiments/compare-models/", depth: 0, kind: "folder" },
    { path: "niceeval.config.ts", depth: 0, kind: "file", note: "config" },
  ],
  agents: [
    { path: "PROMPT.md", depth: 0, kind: "file" },
    { path: "EVAL.ts", depth: 0, kind: "file" },
    { path: "__niceeval__/results.json", depth: 0, kind: "file" },
  ],
};

function fileIcon(item) {
  if (item.kind === "folder") return <Folder size={14} />;
  if (item.path.endsWith("config.ts")) return <Wrench size={14} />;
  if (item.path.endsWith(".json")) return <Terminal size={14} />;
  return <FileCode2 size={14} />;
}

// 呼应 fileTree.humans 里的 experiments/compare-models/：同一个 agent 换模型跑同一批 eval，
// 通过率并排对比。agent/model 名和文件夹名一样是标识符，不随语言切换翻译。
const compareCard = {
  group: "compare-models",
  rows: [
    { name: "gpt-5.4", score: 100 },
    { name: "deepseek-v4-pro", score: 60 },
  ],
};

function getBlogPost(blogPosts, slug) {
  return blogPosts.find((post) => post.slug === slug);
}

const codeTheme = {
  ...themes.vsDark,
  plain: { ...themes.vsDark.plain, backgroundColor: "transparent" },
};

const copy = {
  en: {
    meta: "NiceEval is a lightweight, agent-native TypeScript eval tool for AI agents and coding-agent workflows.",
    navStart: "Start",
    blog: "Blog",
    docs: "Docs",
    languageLabel: "Switch language",
    modes: {
      humans: {
        label: "For humans",
        cta: "Docs",
        caption: "Read the quickstart guide, then write a TypeScript eval and run it across targets without building a bespoke harness.",
      },
      agents: {
        label: "For agents",
        command: initPrompt,
        caption: "Paste this prompt into your coding agent so it installs and wires up NiceEval on its own.",
      },
    },
    heroTitle: "AI-Native Eval for Agents.",
    copyCommand: "Copy command",
    copied: "copied",
    primaryAction: "Start",
    github: "GitHub",
    visualLabel: "NiceEval product diagram",
    fileCardRoot: "your-project/",
    fileNotes: {
      adapter: "adapter",
      config: "config",
    },
    runStatusPassed: "passed",
    workflowLabel: "NiceEval workflow",
    steps: [
      ["Connect", "Connect your agent — or CC/Codex — via an adapter plus o11y."],
      ["Define", "Write evals and experiments the way you'd write unit tests."],
      ["Evaluate", "Evaluate directly, or in parallel inside a sandbox."],
    ],
    setupEyebrow: "Eval examples",
    setupTitle: "eval chats, tool calls, and coding agents",
    setupCaption: "Each card is a runnable defineEval file. Click a highlighted line to peek at replies and assertion notes.",
    timingLabel: "Timing trace",
    blogPage: {
      meta: "Why NiceEval needs evals, traces, fixtures, and clear product-level feedback loops.",
      eyebrow: "NiceEval Blog",
      title: "Notes on building agent evals.",
      intro: "Longer-form product and engineering notes. The first essay is about why evals are a necessary feedback loop for agent work.",
      latest: "Latest article",
      read: "Read article",
      back: "Back to blog",
      minutes: "min read",
      notFound: "Article not found",
    },
  },
  zh: {
    meta: "NiceEval 是轻量、Agent-Native、DX 体验好的 TypeScript agent eval 工具，适合评 AI agents 和 coding-agent workflows。",
    navStart: "开始",
    blog: "博客",
    docs: "文档",
    languageLabel: "切换语言",
    modes: {
      humans: {
        label: "给人类",
        cta: "文档",
        caption: "阅读快速开始文档，再写一个 TypeScript eval，在不同目标上运行，不用自建评测脚手架。",
      },
      agents: {
        label: "给 Agent",
        command: initPrompt,
        caption: "把这段 prompt 粘贴给你的 coding agent，让它自己安装并接入 NiceEval。",
      },
    },
    heroTitle: "更适合 Agent 的 Eval。",
    copyCommand: "复制命令",
    copied: "已复制",
    primaryAction: "开始",
    github: "GitHub",
    visualLabel: "NiceEval 产品示意图",
    fileCardRoot: "你的项目/",
    fileNotes: {
      adapter: "适配器",
      config: "配置",
    },
    runStatusPassed: "通过",
    workflowLabel: "NiceEval 工作流",
    steps: [
      ["接入", "通过适配器与o11y，接入你的 Agent 或者 CC/Codex"],
      ["定义", "像写单元测试一样写 eval 与 experiment"],
      ["评估", "直接或者在 sandbox 并行评估"],
    ],
    setupEyebrow: "Eval 示例",
    setupTitle: "Eval 对话、工具调用与 coding agent",
    setupCaption: "每张卡都是一个可直接运行的 defineEval 文件。点击高亮行，展开助手回复和断言说明。",
    timingLabel: "耗时追踪",
    blogPage: {
      meta: "为什么 NiceEval 需要 eval、trace、fixture 和清晰的产品反馈回路。",
      eyebrow: "NiceEval 博客",
      title: "关于 agent eval 的笔记。",
      intro: "这里放更长一点的产品与工程笔记。第一篇文章讨论：为什么我们需要 eval。",
      latest: "最新文章",
      read: "阅读文章",
      back: "返回博客",
      minutes: "分钟阅读",
      notFound: "没有找到这篇文章",
    },
  },
};

function detectLocale() {
  if (typeof window === "undefined") return "en";
  let saved;
  try {
    saved = window.localStorage.getItem("niceeval-locale");
  } catch {
    saved = undefined;
  }
  if (saved === "zh" || saved === "en") return saved;
  return window.navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export default function SiteAppClient({ initialRoute, blogPosts }) {
  const router = useRouter();
  const [locale, setLocale] = useState("en");
  const route = initialRoute;
  const t = copy[locale];

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    const resolvedLocale = detectLocale();
    setLocale((current) => (current === resolvedLocale ? current : resolvedLocale));
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("niceeval-locale", locale);
    } catch {
      // Language selection still works for the current session.
    }
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.querySelector('meta[name="description"]')?.setAttribute(
      "content",
      route.name === "home" ? t.meta : t.blogPage.meta,
    );
  }, [locale, route.name, t.blogPage.meta, t.meta]);

  const navigate = (href) => {
    router.push(href);
  };

  return (
    <>
      <Header locale={locale} setLocale={setLocale} t={t} route={route} navigate={navigate} />
      <main>
        {route.name === "home" ? (
          <>
            <Hero t={t} locale={locale} navigate={navigate} />
            <Strip t={t} />
            <Setup t={t} locale={locale} />
          </>
        ) : route.name === "blog" ? (
          <BlogIndex t={t} locale={locale} navigate={navigate} blogPosts={blogPosts} />
        ) : (
          <BlogArticle t={t} locale={locale} route={route} navigate={navigate} blogPosts={blogPosts} />
        )}
      </main>
    </>
  );
}

function Header({ locale, setLocale, t, route, navigate }) {
  const nextLocale = locale === "en" ? "zh" : "en";

  return (
    <header className="topbar shell">
      <a
        className="brand"
        href="/"
        aria-label="NiceEval home"
        onClick={(event) => {
          event.preventDefault();
          track("Click Home Link", { location: "header" });
          navigate("/");
        }}
      >
        <span className="mark" />
        <span>NiceEval</span>
      </a>
      <nav className="nav" aria-label="Primary">
        <a
          href={route.name === "home" ? "#setup" : "/#setup"}
          onClick={(event) => {
            track("Click Nav Start");
            if (route.name !== "home") {
              event.preventDefault();
              navigate("/#setup");
            }
          }}
        >
          {t.navStart}
        </a>
        <a
          href={blogPath}
          onClick={(event) => {
            event.preventDefault();
            track("Click Blog Link", { location: "header", locale });
            navigate(blogPath);
          }}
        >
          {t.blog}
        </a>
        <a href={docsUrl[locale]} onClick={() => track("Click Docs Link", { location: "header", locale })}>{t.docs}</a>
        <a href={githubUrl} onClick={() => track("Click GitHub Link", { location: "header" })}>{t.github}</a>
        <button
          type="button"
          className="lang-toggle"
          aria-label={t.languageLabel}
          onClick={() => {
            track("Switch Language", { from: locale, to: nextLocale });
            setLocale(nextLocale);
          }}
        >
          {nextLocale === "zh" ? "中文" : "EN"}
        </button>
      </nav>
    </header>
  );
}

function Hero({ t, locale, navigate }) {
  const [mode, setMode] = useState("humans");
  const [copied, setCopied] = useState(false);
  const active = t.modes[mode];
  const copyCommand = async () => {
    try {
      await navigator.clipboard?.writeText(active.command);
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
          {Object.entries(t.modes).map(([key, item]) => (
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
            {active.cta}
          </a>
        ) : (
          <div className="copy-row">
            <code>{active.command}</code>
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
          <a
            className="button ghost"
            href={blogPath}
            onClick={(event) => {
              event.preventDefault();
              track("Click Blog Link", { location: "hero", locale });
              navigate(blogPath);
            }}
          >
            <BookOpen size={15} />
            {t.blog}
          </a>
        </div>
      </div>

      <ProductVisual mode={mode} t={t} />
    </section>
  );
}

function BlogIndex({ t, locale, navigate, blogPosts }) {
  const post = blogPosts[0];
  const postCopy = post[locale];

  return (
    <section className="blog-page shell">
      <div className="blog-hero">
        <p className="eyebrow">{t.blogPage.eyebrow}</p>
        <h1>{t.blogPage.title}</h1>
        <p>{t.blogPage.intro}</p>
      </div>
      <div className="blog-section-head">
        <h2>{t.blogPage.latest}</h2>
      </div>
      <article className="blog-card">
        <div className="blog-card-art" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="blog-card-copy">
          <span className="post-kicker">{postCopy.category}</span>
          <h2>{postCopy.title}</h2>
          <p>{postCopy.description}</p>
          <PostMeta post={post} postCopy={postCopy} t={t} />
          <a
            className="button primary"
            href={`${blogPath}/${post.slug}`}
            onClick={(event) => {
              event.preventDefault();
              track("Open Blog Post", { slug: post.slug, locale });
              navigate(`${blogPath}/${post.slug}`);
            }}
          >
            {t.blogPage.read}
            <ChevronRight size={15} />
          </a>
        </div>
      </article>
    </section>
  );
}

function BlogArticle({ t, locale, route, navigate, blogPosts }) {
  const post = getBlogPost(blogPosts, route.slug);

  if (!post) {
    return (
      <section className="blog-page shell">
        <BlogBackLink t={t} navigate={navigate} />
        <div className="blog-hero">
          <h1>{t.blogPage.notFound}</h1>
        </div>
      </section>
    );
  }

  const postCopy = post[locale];

  return (
    <article className="article-page shell">
      <BlogBackLink t={t} navigate={navigate} />
      <header className="article-header">
        <div>
          <span className="post-kicker">{postCopy.category}</span>
          <h1>{postCopy.title}</h1>
          <p>{postCopy.description}</p>
          <PostMeta post={post} postCopy={postCopy} t={t} />
        </div>
        <div className="article-mark" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      </header>
      <MdxBody source={postCopy.body} />
    </article>
  );
}

function BlogBackLink({ t, navigate }) {
  return (
    <a
      className="back-link"
      href={blogPath}
      onClick={(event) => {
        event.preventDefault();
        track("Back To Blog");
        navigate(blogPath);
      }}
    >
      <ArrowLeft size={15} />
      {t.blogPage.back}
    </a>
  );
}

function PostMeta({ post, postCopy, t }) {
  return (
    <div className="post-meta">
      <span>
        <CalendarDays size={14} />
        {postCopy.date}
      </span>
      <span>
        <Clock3 size={14} />
        {postCopy.readMinutes} {t.blogPage.minutes}
      </span>
      <span>{postCopy.category}</span>
    </div>
  );
}

function MdxBody({ source }) {
  const blocks = parseMarkdownBlocks(source);

  return (
    <div className="article-body">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const HeadingTag = `h${block.level}`;
          return <HeadingTag key={index}>{formatInline(block.text)}</HeadingTag>;
        }
        if (block.type === "quote") {
          return <blockquote key={index}>{formatInline(block.text)}</blockquote>;
        }
        if (block.type === "list") {
          return (
            <ul key={index}>
              {block.items.map((item) => (
                <li key={item}>{formatInline(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "code") {
          return <pre key={index}><code>{block.text}</code></pre>;
        }
        return <p key={index}>{formatInline(block.text)}</p>;
      })}
    </div>
  );
}

function parseMarkdownBlocks(source) {
  const lines = source.trim().split("\n");
  const blocks = [];
  let paragraph = [];
  let list = [];
  let code = [];
  let inCode = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push({ type: "list", items: list });
    list = [];
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        blocks.push({ type: "code", text: code.join("\n") });
        code = [];
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }
    if (line.startsWith("> ")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "quote", text: line.slice(2) });
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      list.push(line.slice(2));
      continue;
    }
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  return blocks;
}

function formatInline(text) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    return part;
  });
}

function ProductVisual({ mode, t }) {
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

function Strip({ t }) {
  return (
    <section className="strip shell" aria-label={t.workflowLabel}>
      {t.steps.map(([title, text], index) => (
        <Step key={title} k={String(index + 1)} title={title} text={text} />
      ))}
    </section>
  );
}

function Step({ k, title, text }) {
  return (
    <article>
      <span>{k}</span>
      <h2>{title}</h2>
      <p>{text}</p>
    </article>
  );
}

function Setup({ t, locale }) {
  const [activeId, setActiveId] = useState(evalExamples[0].id);
  // 自动轮播：进入视口才转，悬停在卡组上暂停；用户任何点击不停止轮播，只把倒计时清零重来。
  const [resetKey, setResetKey] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [inView, setInView] = useState(false);
  const sectionRef = useRef(null);
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

  const activate = (id, source) => {
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

function EvalCard({ t, example, locale, active, offset, onActivate }) {
  const [openLines, setOpenLines] = useState(() => new Set());
  const [timingOpen, setTimingOpen] = useState(false);
  const card = example[locale];
  const meta = example.meta;

  const toggleLine = (lineNo, noteKey) => {
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
    // 后排卡片只当"切换到这个示例"的按钮用：整卡可点，内容对读屏和 Tab 键隐藏(键盘走左侧 tablist)。
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
                          ? (event) => {
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
