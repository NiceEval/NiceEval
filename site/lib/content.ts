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

export type FileTreeItem = {
  path: string;
  depth: number;
  kind: "file" | "folder";
  note?: "adapter" | "config";
};

export const fileTree: Record<"humans" | "agents", FileTreeItem[]> = {
  humans: [
    { path: "agents/web-agent.ts", depth: 0, kind: "file", note: "adapter" },
    { path: "evals/", depth: 0, kind: "folder" },
    { path: "weather-tool.eval.ts", depth: 1, kind: "file" },
    { path: "image-understanding.eval.ts", depth: 1, kind: "file" },
    { path: "experiments/compare-models/", depth: 0, kind: "folder" },
    { path: "niceeval.config.ts", depth: 0, kind: "file", note: "config" },
  ],
  agents: [
    { path: "agents/my-bot.ts", depth: 0, kind: "file", note: "adapter" },
    { path: "experiments/my-bot.ts", depth: 0, kind: "file" },
    { path: "evals/refund-policy.eval.ts", depth: 0, kind: "file" },
    { path: "niceeval.config.ts", depth: 0, kind: "file", note: "config" },
  ],
};

// 呼应 fileTree.humans 里的 experiments/compare-models/:同一个 agent 换模型跑同一批 eval,
// 通过率并排对比。agent/model 名和文件夹名一样是标识符,不随语言切换翻译。
export const compareCard = {
  group: "compare-models",
  rows: [
    { name: "gpt-5.4", score: 100 },
    { name: "deepseek-v4-pro", score: 60 },
  ],
};

export const copy = {
  en: {
    // 页面级 <title>:每页独特、带功能描述,避免整站共用 "NiceEval" 被判重复内容。
    titleHome: "NiceEval — Eval Tool for AI Agents & Coding Agents",
    titleBlog: "Agent Eval Blog",
    meta: "NiceEval is an agent-native eval tool for AI agents and coding-agent workflows.",
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
    titleHome: "NiceEval —— AI Agent 与 Coding Agent 的评测（Eval）工具",
    titleBlog: "Agent 评测博客",
    meta: "NiceEval 是 Agent-Native、DX 体验好的 agent eval 工具,适合评 AI agents 和 coding-agent workflows。",
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
      ["接入", "通过适配器与o11y,接入你的 Agent 或者 CC/Codex"],
      ["定义", "像写单元测试一样写 eval 与 experiment"],
      ["评估", "直接或者在 sandbox 并行评估"],
    ],
    setupEyebrow: "Eval 示例",
    setupTitle: "Eval 对话、工具调用与 coding agent",
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
