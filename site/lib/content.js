export const locales = ["en", "zh"];
export const defaultLocale = "en";

export function hasLocale(locale) {
  return locales.includes(locale);
}

export function otherLocale(locale) {
  return locale === "en" ? "zh" : "en";
}

// 拼语言前缀路径:withLocale("en") -> "/en", withLocale("en", "blog/foo") -> "/en/blog/foo"
export function withLocale(locale, path = "") {
  return path ? `/${locale}/${path}` : `/${locale}`;
}

export const githubUrl = "https://github.com/CorrectRoadH/niceeval";
export const blogSegment = "blog";

// 文档站按语言分入口:en 是默认语言走根路径,zh 走 /zh 前缀。
export const docsUrl = {
  en: "https://niceeval.com/docs/quickstart",
  zh: "https://niceeval.com/docs/zh/quickstart",
};

export const initPrompt =
  "READ https://raw.githubusercontent.com/CorrectRoadH/niceeval/refs/heads/main/INIT.md and install niceeval for this repo.";

export const fileTree = {
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
    meta: "NiceEval 是 Agent-Native、DX 体验好的 agent eval 工具,适合评 AI agents 和 coding-agent workflows。",
    navStart: "开始",
    blog: "博客",
    docs: "文档",
    languageLabel: "切换语言",
    modes: {
      humans: {
        label: "给人类",
        cta: "文档",
        caption: "阅读快速开始文档，写一个 eval，直接在不同目标上运行，不用自己搭评测脚手架。",
      },
      agents: {
        label: "给 Agent",
        command: initPrompt,
        caption: "把这段 prompt 粘贴给你的 coding agent,让它自己安装并接入 NiceEval。",
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
    blogPage: {
      meta: "为什么 NiceEval 需要 eval、trace、fixture 和清晰的产品反馈回路。",
      eyebrow: "NiceEval 博客",
      title: "关于 agent eval 的笔记。",
      intro: "这里放更长一点的产品与工程笔记。第一篇文章讨论:为什么我们需要 eval。",
      latest: "最新文章",
      read: "阅读文章",
      back: "返回博客",
      minutes: "分钟阅读",
      notFound: "没有找到这篇文章",
    },
  },
};

export function getDictionary(locale) {
  return copy[hasLocale(locale) ? locale : defaultLocale];
}
