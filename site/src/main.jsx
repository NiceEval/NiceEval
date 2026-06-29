import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CheckCircle2,
  Clipboard,
  FileCode2,
  Folder,
  GitFork,
  Play,
  Terminal,
  Wrench,
} from "lucide-react";
import "./styles.css";

const githubUrl = "https://github.com/CorrectRoadH/fasteval";

const files = {
  humans: ["evals/weather.eval.ts", "fasteval.config.ts", ".fasteval/latest"],
  agents: ["PROMPT.md", "EVAL.ts", "__fasteval__/results.json"],
};

const copy = {
  en: {
    meta: "fasteval is a lightweight TypeScript agent eval tool for agents, services, functions, and coding-agent fixtures.",
    navStart: "Start",
    languageLabel: "Switch language",
    modes: {
      humans: {
        label: "For teams",
        command: "npx fasteval init",
        caption: "Write a TypeScript eval, run it across targets, and read the evidence without building a bespoke harness.",
      },
      agents: {
        label: "For agents",
        command: "npx fasteval --agent codex fixtures/button",
        caption: "Give any agent a real task, then grade the answer, the workspace, and the path it took.",
      },
    },
    heroTitle: "Lightweight agent evals for every project.",
    copyCommand: "Copy command",
    copied: "copied",
    primaryAction: "Start",
    github: "GitHub",
    visualLabel: "fasteval product diagram",
    runStatusPassed: "passed",
    scoreLabel: "Pass rate",
    workflowLabel: "fasteval workflow",
    steps: [
      ["Define", "Describe correct behavior in a small TypeScript file."],
      ["Run", "Use the same eval for agents, services, functions, or fixtures."],
      ["Inspect", "Read verdicts, traces, costs, and workspace evidence."],
    ],
    setupEyebrow: "Start",
    setupTitle: "Install. Init. Evaluate.",
  },
  zh: {
    meta: "fasteval 是轻量、通用、DX 体验好的 TypeScript agent eval 工具，适合评 agents、services、functions 和 coding-agent fixtures。",
    navStart: "开始",
    languageLabel: "切换语言",
    modes: {
      humans: {
        label: "给团队",
        command: "npx fasteval init",
        caption: "写一个 TypeScript eval，就能在不同目标上运行并查看证据，不用自建评测脚手架。",
      },
      agents: {
        label: "给 Agent",
        command: "npx fasteval --agent codex fixtures/button",
        caption: "给任意 agent 一个真实任务，再评它的回答、工作区结果和执行路径。",
      },
    },
    heroTitle: "适合每个项目的轻量 Agent Evals。",
    copyCommand: "复制命令",
    copied: "已复制",
    primaryAction: "开始",
    github: "GitHub",
    visualLabel: "fasteval 产品示意图",
    runStatusPassed: "通过",
    scoreLabel: "通过率",
    workflowLabel: "fasteval 工作流",
    steps: [
      ["定义", "用一个小 TypeScript 文件描述什么算正确。"],
      ["运行", "同一个 eval 可评 agents、services、functions 或 fixtures。"],
      ["检查", "查看判决、trace、成本和工作区证据。"],
    ],
    setupEyebrow: "开始",
    setupTitle: "安装。初始化。开始评测。",
  },
};

function detectLocale() {
  let saved;
  try {
    saved = window.localStorage.getItem("fasteval-locale");
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
      window.localStorage.setItem("fasteval-locale", locale);
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
        <Hero t={t} />
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
      <a className="brand" href="#top" aria-label="fasteval home">
        <span className="mark" />
        <span>fasteval</span>
      </a>
      <nav className="nav" aria-label="Primary">
        <a href="#setup">{t.navStart}</a>
        <a href={githubUrl}>{t.github}</a>
        <button type="button" className="lang-toggle" aria-label={t.languageLabel} onClick={() => setLocale(nextLocale)}>
          {nextLocale === "zh" ? "中文" : "EN"}
        </button>
      </nav>
    </header>
  );
}

function Hero({ t }) {
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
        <div className="copy-row">
          <code>$ {active.command}</code>
          <button type="button" aria-label={t.copyCommand} onClick={copyCommand}>
            <Clipboard size={16} />
          </button>
          <span className={copied ? "copy-status visible" : "copy-status"}>{t.copied}</span>
        </div>
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
          <span>evals/</span>
        </div>
        <ul>
          {files[mode].map((file, index) => (
            <li key={file}>
              {index === 0 ? <FileCode2 size={16} /> : index === 1 ? <Wrench size={16} /> : <Terminal size={16} />}
              <span>{file}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="run-card">
        <code>$ fasteval</code>
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
        <span>{t.scoreLabel}</span>
        <strong>91.7%</strong>
        <div className="score-bars" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
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
      <div>
        <p className="eyebrow">{t.setupEyebrow}</p>
        <h2>{t.setupTitle}</h2>
      </div>
      <pre>{`npm install -D fasteval
npx fasteval init
npx fasteval`}</pre>
    </section>
  );
}

createRoot(document.getElementById("root")).render(<App />);
