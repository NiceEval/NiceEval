import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
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
import "./styles.css";

const githubUrl = "https://github.com/CorrectRoadH/niceeval";

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

// 原样取自 examples/zh/ai-sdk/evals/multi-turn-image.eval.ts —— 代码是标识符/真实源码，不随语言切换翻译；
// 只有卡片外壳的文案(状态、描述、逐行注解)按 locale 走 copy。
const evalSourceLines = [
  'import { defineEval } from "niceeval";',
  "",
  "// 评测：先发图片，后续两轮纯文字追问。",
  "//",
  "// 第一轮：图片（蓝底白方块）+ 文字问题，考图片理解。",
  "// 第二、三轮：纯文字追问，考助手是否记住了第一轮的图片内容（跨轮图片上下文）。",
  "// 图片文件与本 eval 同目录：evals/sample.png。",
  "export default defineEval({",
  '  description: "测试 agent 在多轮对话中基于图片内容作答的能力",',
  "",
  "  async test(t) {",
  '    await t.sendFile("evals/sample.png", "这张图片里有什么？");',
  '    await t.send("图片里的背景是什么颜色？");',
  '    await t.send("中间那个形状是什么颜色的？");',
  "",
  '    await t.group("三轮都正常收发", () => {',
  "      // succeeded() 确认这三轮对话都正常收发，没有失败，也没有卡在 HITL。",
  '      // (注:事件流现在也含 user 消息,所以不要再用 event("message",{count}) 数"轮数"。)',
  "      t.succeeded();",
  "    });",
  "",
  '    await t.group("第一轮识别出图片内容", () => {',
  "      t.messageIncludes(/蓝|blue|白|方块|square/i);",
  "    });",
  "",
  '    await t.group("后续追问能联系图片上下文", () => {',
  '      // 第二轮问背景色，助手应答"蓝"；第三轮问形状颜色，应答"白"',
  "      // 注意：t.messageIncludes 是 run 级断言，拼接整次运行所有 assistant 消息（不只最后一轮）。",
  "      t.messageIncludes(/白|white/i);",
  "    });",
  "",
  "    t.judge.autoevals",
  '      .closedQA("助手是否在三轮对话中始终基于第一轮发送的图片内容作答，而不是凭空发挥？")',
  "      .gate(0.7);",
  "  },",
  "});",
];

const evalFile = {
  gateBadge: "1/0.7",
  gateLine: 34,
  // 三种可点开的行：turn* 是发送的消息(点开看模拟回复)，其余是断言(点开看解释)。
  highlights: {
    12: "turn1",
    13: "turn2",
    14: "turn3",
    19: "succeeded",
    23: "recognize",
    29: "followup",
    34: "gate",
  },
  replyLines: new Set(["turn1", "turn2", "turn3"]),
  source: evalSourceLines.join("\n"),
};

const codeTheme = {
  ...themes.vsDark,
  plain: { ...themes.vsDark.plain, backgroundColor: "transparent" },
};

const copy = {
  en: {
    meta: "NiceEval is a lightweight TypeScript agent eval tool for agents, services, functions, and coding-agent fixtures.",
    navStart: "Start",
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
    heroTitle: "An eval that's actually built for agents.",
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
      ["Define", "Describe correct behavior in a small TypeScript file."],
      ["Run", "Use the same eval for agents, services, functions, or fixtures."],
      ["Inspect", "Read verdicts, traces, costs, and workspace evidence."],
    ],
    setupEyebrow: "Eval example",
    setupTitle: "Effortlessly eval multi-turn conversations.",
    evalCard: {
      notes: {
        turn1: 'Turn 1 · sendFile(evals/sample.png) — assistant reply: "The image shows a blue background with a white square in the middle."',
        turn2: 'Turn 2 · send(follow-up) — assistant reply: "The background is blue."',
        turn3: 'Turn 3 · send(follow-up) — assistant reply: "The shape in the middle is white."',
        succeeded: "succeeded() confirms all three turns went through cleanly — no failures and no stalls waiting on a human-in-the-loop prompt.",
        recognize: "The regex matches Chinese and English keywords together, so this only passes if the assistant actually named the blue background and white square.",
        followup: "This assertion runs at the run level — it scans every assistant message across all three turns, not just the last reply.",
        gate: "A closedQA judge checks whether the assistant kept grounding every answer in turn one's image; the run only passes with a score at or above 0.7.",
      },
      timingLabel: "Timing trace",
      timingRows: [
        { label: "Turn 1 · sendFile(image)", value: "2.1s" },
        { label: "Turn 2 · send(follow-up)", value: "1.3s" },
        { label: "Turn 3 · send(follow-up)", value: "1.5s" },
        { label: "judge.autoevals.closedQA", value: "0.9s" },
      ],
      timingTotal: "5.8s total · $0.006 est.",
    },
  },
  zh: {
    meta: "NiceEval 是轻量、通用、DX 体验好的 TypeScript agent eval 工具，适合评 agents、services、functions 和 coding-agent fixtures。",
    navStart: "开始",
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
      ["定义", "用一个小 TypeScript 文件描述什么算正确。"],
      ["运行", "同一个 eval 可评 agents、services、functions 或 fixtures。"],
      ["检查", "查看判决、trace、成本和工作区证据。"],
    ],
    setupEyebrow: "Eval 示例",
    setupTitle: "轻松 Eval 多轮对话。",
    evalCard: {
      notes: {
        turn1: "第 1 轮 · sendFile(evals/sample.png) — 助手回复：「图片是一个蓝色背景，中间有一个白色方块。」",
        turn2: "第 2 轮 · send(追问) — 助手回复：「背景是蓝色。」",
        turn3: "第 3 轮 · send(追问) — 助手回复：「中间的形状是白色。」",
        succeeded: "succeeded() 确认这三轮对话都正常收发，没有失败，也没有卡在人工介入(HITL)。",
        recognize: "正则同时匹配中英文关键词，只有助手真的说出蓝色背景和白色方块才算通过。",
        followup: "这是 run 级断言——会扫描整次运行里所有 assistant 消息，而不只是最后一轮回复。",
        gate: "closedQA judge 检查助手是否全程都基于第一轮的图片作答；分数达到 0.7 才算通过。",
      },
      timingLabel: "耗时追踪",
      timingRows: [
        { label: "第 1 轮 · sendFile(图片)", value: "2.1s" },
        { label: "第 2 轮 · send(追问)", value: "1.3s" },
        { label: "第 3 轮 · send(追问)", value: "1.5s" },
        { label: "judge.autoevals.closedQA", value: "0.9s" },
      ],
      timingTotal: "共 5.8s · 预估 $0.006",
    },
  },
};

function detectLocale() {
  let saved;
  try {
    saved = window.localStorage.getItem("niceeval-locale");
  } catch {
    saved = undefined;
  }
  if (saved === "zh" || saved === "en") return saved;
  return window.navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function App() {
  const [locale, setLocale] = useState(detectLocale);
  const t = copy[locale];

  useEffect(() => {
    try {
      window.localStorage.setItem("niceeval-locale", locale);
    } catch {
      // Language selection still works for the current session.
    }
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.querySelector('meta[name="description"]')?.setAttribute("content", t.meta);
  }, [locale, t.meta]);

  return (
    <>
      <Header locale={locale} setLocale={setLocale} t={t} />
      <main>
        <Hero t={t} locale={locale} />
        <Strip t={t} />
        <Setup t={t} />
      </main>
    </>
  );
}

function Header({ locale, setLocale, t }) {
  const nextLocale = locale === "en" ? "zh" : "en";

  return (
    <header className="topbar shell">
      <a className="brand" href="#top" aria-label="NiceEval home">
        <span className="mark" />
        <span>NiceEval</span>
      </a>
      <nav className="nav" aria-label="Primary">
        <a href="#setup">{t.navStart}</a>
        <a href={docsUrl[locale]}>{t.docs}</a>
        <a href={githubUrl}>{t.github}</a>
        <button type="button" className="lang-toggle" aria-label={t.languageLabel} onClick={() => setLocale(nextLocale)}>
          {nextLocale === "zh" ? "中文" : "EN"}
        </button>
      </nav>
    </header>
  );
}

function Hero({ t, locale }) {
  const [mode, setMode] = useState("humans");
  const [copied, setCopied] = useState(false);
  const active = t.modes[mode];
  const copyCommand = async () => {
    try {
      await navigator.clipboard?.writeText(active.command);
    } catch {
      // Some browsers block clipboard access outside secure contexts.
    }
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
              onClick={() => setMode(key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {mode === "humans" ? (
          <a className="button primary docs-cta" href={docsUrl[locale]} target="_blank" rel="noreferrer">
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
          <a className="button primary" href="#setup">
            <Play size={15} />
            {t.primaryAction}
          </a>
          <a className="button ghost" href={githubUrl}>
            <GitFork size={15} />
            {t.github}
          </a>
        </div>
      </div>

      <ProductVisual mode={mode} t={t} />
    </section>
  );
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

function Setup({ t }) {
  return (
    <section id="setup" className="setup shell">
      <div className="setup-intro">
        <p className="eyebrow">{t.setupEyebrow}</p>
        <h2>{t.setupTitle}</h2>
      </div>
      <EvalCard t={t} card={t.evalCard} />
    </section>
  );
}

function EvalCard({ t, card }) {
  const [openLines, setOpenLines] = useState(() => new Set());
  const [timingOpen, setTimingOpen] = useState(false);

  const toggleLine = (lineNo) => {
    setOpenLines((prev) => {
      const next = new Set(prev);
      if (next.has(lineNo)) next.delete(lineNo);
      else next.add(lineNo);
      return next;
    });
  };

  return (
    <div className="setup-card">
      <div className="setup-card-head">
        <span className="pill">{t.runStatusPassed}</span>
      </div>
      <div className="setup-panel">
        <Highlight code={evalFile.source} language="tsx" theme={codeTheme}>
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <pre className={`eval-code ${className}`} style={style}>
              {tokens.map((line, i) => {
                const lineNo = i + 1;
                const noteKey = evalFile.highlights[lineNo];
                const isReply = noteKey ? evalFile.replyLines.has(noteKey) : false;
                const open = openLines.has(lineNo);
                const lineClassName = noteKey ? `code-line interactive ${isReply ? "reply" : "assertion"}` : "code-line";
                return (
                  <React.Fragment key={lineNo}>
                    <div
                      {...getLineProps({ line, className: lineClassName })}
                      role={noteKey ? "button" : undefined}
                      tabIndex={noteKey ? 0 : undefined}
                      aria-expanded={noteKey ? open : undefined}
                      onClick={noteKey ? () => toggleLine(lineNo) : undefined}
                      onKeyDown={
                        noteKey
                          ? (event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                toggleLine(lineNo);
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
                          {lineNo === evalFile.gateLine ? <span className="gate-badge">{evalFile.gateBadge}</span> : null}
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
      <button type="button" className="eval-more" aria-expanded={timingOpen} onClick={() => setTimingOpen((v) => !v)}>
        <ChevronRight size={13} className={timingOpen ? "chev open" : "chev"} />
        {card.timingLabel}
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

createRoot(document.getElementById("root")).render(<App />);
