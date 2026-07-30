export const locales = ["en", "zh"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export function hasLocale(locale: string): locale is Locale {
  return (locales as readonly string[]).includes(locale);
}

export function otherLocale(locale: Locale): Locale {
  return locale === "en" ? "zh" : "en";
}

// 拼语言前缀路径:withLocale("en") -> "/en", withLocale("en", "blog/foo") -> "/en/blog/foo"
export function withLocale(locale: Locale, path = "") {
  return path ? `/${locale}/${path}` : `/${locale}`;
}

export const githubUrl = "https://github.com/CorrectRoadH/niceeval";
export const blogSegment = "blog";

// 文档站按语言分入口:en 是默认语言走根路径,zh 走 /zh 前缀。
export const docsUrl: Record<Locale, string> = {
  en: "https://niceeval.com/docs/quickstart",
  zh: "https://niceeval.com/docs/zh/tutorials/quickstart",
};

export const initPrompt =
  "READ https://niceeval.com/INIT.md and install niceeval for this repo.";

// Hero 的两套终端动画本身不做 i18n:屏幕里回放的是真实终端会话,CLI 打出来什么字面量
// 就写什么(见 site-home-terminal.tsx / site-home-agent-terminal.tsx)。这里只留窗口外面的
// 无障碍文案——它们描述的是网页控件,不是终端内容。

export const copy = {
  en: {
    // 页面级 <title>:每页独特、带功能描述,避免整站共用 "NiceEval" 被判重复内容。
    titleHome: "NiceEval — Agent-Native Eval Framework and Eval harness for AI Applications",
    titleBlog: "Agent Eval Blog",
    meta: "NiceEval is a framework-agnostic agent eval tool, giving you a complete closed loop for building evals for your agents or coding agents.",
    navStart: "Start",
    blog: "Blog",
    docs: "Docs",
    languageLabel: "Switch language",
    modes: {
      humans: {
        label: "For humans",
        cta: "Docs",
        caption: "Read the quickstart guide, then write an eval and run it across targets without building a bespoke harness.",
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
    github: "GitHub",
    visualLabel: "NiceEval terminal demo: run an experiment, then compare two models",
    visualLabelAgents: "Terminal demo: Claude Code installs NiceEval, runs the evals, and fixes the failure",
    replay: "Replay animation",
    runStatusPassed: "passed",
    workflowLabel: "NiceEval workflow",
    steps: [
      ["Connect", "Connect your agent — or CC/Codex — via an adapter plus o11y."],
      ["Define", "Write evals and experiments the way you'd write unit tests."],
      ["Evaluate", "Evaluate in parallel."],
    ],
    setupEyebrow: "Eval examples",
    setupTitle: "eval chats, tool calls, and coding agents",
    setupCaption: "Each card is a runnable defineEval file. Click a highlighted line to peek at replies and assertion notes.",
    timingLabel: "Timing trace",
    loopEyebrow: "Agents are users too",
    loopTitle: "turn evals into a loop",
    loopCaption:
      "The NiceEval CLI is designed for agents as much as for humans — not just an evaluation tool, but a framework that loops: build evals, run them, improve the agent system. Every output has an agent-readable face, so a coding agent drives the whole loop over bash.",
    loopTerminalLabel: "terminal",
    // 环上四段弧线箭头:[标题, 对应的 CLI 命令]。标题一个词,命令用缩略形态,
    // 两者都必须极短——写在弧带内部,长了会撑出弧带。重跑不单列:环回到 eval 就是重跑。
    loopSteps: [
      ["eval", "exp local"],
      ["triage", "show @id"],
      ["trace", "show --source"],
      ["refine", "claude"],
    ],
    blogPage: {
      meta: "The NiceEval team's product and engineering blog. How to build evals for your agent with NiceEval.",
      eyebrow: "NiceEval Blog",
      title: "Blog",
      intro: "The NiceEval team's product and engineering blog.",
      latest: "Latest article",
      read: "Read article",
      back: "Back to blog",
      minutes: "min read",
      notFound: "Article not found",
      empty: "No articles yet — the first posts are in progress.",
    },
  },
  zh: {
    titleHome: "NiceEval —— 为你的 AI 应用打造的 Agent-Native 的评估框架与 Harness 配套",
    titleBlog: "Agent 评测博客",
    meta: "NiceEval 是框架无关的 Agent 评估工具，为你的 Agent 或 Coding Agent 构建评估提供完整的闭环。",
    navStart: "开始",
    blog: "博客",
    docs: "文档",
    languageLabel: "切换语言",
    modes: {
      humans: {
        label: "给人类",
        cta: "文档",
        caption: "阅读文档，在 10 分钟内为你的 Agent 构建评估",
      },
      agents: {
        label: "给 Agent",
        command: initPrompt,
        caption: "把这段 prompt 粘贴给你的 CodeX/Claude Code",
      },
    },
    heroTitle: "更适合 Agent 的评估。",
    copyCommand: "复制命令",
    copied: "已复制",
    github: "GitHub",
    visualLabel: "NiceEval 终端演示:跑一次实验,再对照两个模型",
    visualLabelAgents: "终端演示:Claude Code 装上 NiceEval、跑完评估、修掉失败项",
    replay: "重放动画",
    runStatusPassed: "通过",
    workflowLabel: "NiceEval 工作流",
    steps: [
      ["接入", "通过适配器与o11y,接入你的 Agent 或者 CC/Codex"],
      ["定义", "像写单元测试一样写评估与实验"],
      ["评估", "并行评估"],
    ],
    setupEyebrow: "Eval 示例",
    setupTitle: "Eval 对话、工具调用与 Coding Agent",
    setupCaption: "每张卡都是一个可直接运行的 defineEval 文件。点击高亮行,展开助手回复和断言说明。",
    timingLabel: "耗时追踪",
    loopEyebrow: "Agent 也是用户",
    loopTitle: "把评估变成循环",
    loopCaption:
      "NiceEval 的 CLI 把 Agent 也当成用户来设计——它不只是评估工具，而是构建评估、执行评估、优化 Agent 系统的循环框架。每个输出都有给 agent 读的一面，coding agent 靠 bash 就能跑完整个循环。",
    loopTerminalLabel: "终端",
    loopSteps: [
      ["评估", "exp local"],
      ["诊断", "show @id"],
      ["归因", "show --source"],
      ["优化", "claude"],
    ],
    blogPage: {
      meta: "NiceEval 团队的产品和工程博客。如何使用 NiceEval 为你的 Agent 构建评估",
      eyebrow: "NiceEval 博客",
      title: "博客",
      intro: "NiceEval 团队的产品和工程博客",
      latest: "最新文章",
      read: "阅读文章",
      back: "返回博客",
      minutes: "分钟阅读",
      notFound: "没有找到这篇文章",
      empty: "还没有发布文章，第一批内容正在准备中。",
    },
  },
} as const;

export type Dictionary = (typeof copy)[Locale];

export function getDictionary(locale: Locale) {
  return copy[hasLocale(locale) ? locale : defaultLocale];
}
