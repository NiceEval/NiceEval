// 生成「接入 niceeval 前后」的代码对比 MDX，供 docs-site 阅读。
//
// 用法：pnpm run gen:diff-code
//
// 每个对比是 PAIRS 里的一项（source = 接入前目录，target = 接入后目录），
// 未来有新的 before/after 示例时往 PAIRS 里加一项即可。
//
// 渲染成 GitHub PR 式的 diff 视图（双行号列、文件头栏、红绿行、hunk 行）。
// Mintlify 的代码块表达不了行号和文件头，所以这里在生成时用 Shiki 做
// GitHub 配色的语法高亮，直接产出带 className 的 HTML 表格，样式在
// docs-site/github-diff.css（同样由本脚本生成，Mintlify 自动加载仓库里的 .css）。
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { codeToTokens, type ThemedToken } from "shiki";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CSS_OUT = "docs-site/github-diff.css";
const JS_OUT = "docs-site/github-diff.js";

/** 折叠参数：变更行上下各留几行上下文；藏起来的行少于阈值就不折 */
const FOLD_CONTEXT = 3;
const FOLD_MIN_HIDDEN = 4;

interface DiffPair {
  /** 接入前的目录，相对仓库根 */
  source: string;
  /** 接入后的目录，相对仓库根 */
  target: string;
  /** 输出的 MDX 路径，相对仓库根 */
  out: string;
  frontmatter: { title: string; sidebarTitle?: string; description: string };
  /** 正文开头的说明（frontmatter 之后、文件清单之前） */
  intro: string;
  /** 阅读顺序：按前缀匹配排序，越靠前越先读；不匹配的排最后按字母序 */
  order: string[];
  /** 页面分节：文件按前缀归入第一个匹配的节；不匹配的进最后一节 */
  sections: Array<{ title: string; files: string[] }>;
  /** 变更统计的分类（页面开头的表格）：文件按最长前缀归组，行数从实际 diff 统计 */
  statGroups: Array<{ label: string; files: string[] }>;
  /** 这个对比额外排除的文件（精确路径或目录前缀），如 README、env 模板等与接入无关的 */
  exclude?: string[];
}

/** Tier 1 示例的统一分类:必要 = 不写接不上;评测内容按需增长。应用由用户自己启动,
 *  eval 侧不代管进程、不开新端口——没有"起停辅助"这一类。 */
const TIER1_STAT_GROUPS: DiffPair["statGroups"] = [
  { label: "应用侧配置（必要：依赖声明）", files: ["package.json", "tsconfig.json", "pnpm-workspace.yaml"] },
  { label: "adapter（必要：传输粘合，协议映射在官方包里）", files: ["niceeval.config.ts", "agents/"] },
  { label: "evals 与 experiments（评测内容，按需增长）", files: ["evals/", "experiments/"] },
];

const PAIRS: DiffPair[] = [
  {
    source: "examples/zh/origin/pi-sdk",
    target: "examples/zh/tier1/pi-sdk",
    out: "docs-site/zh/example/tier1-pi-sdk.mdx",
    frontmatter: {
      title: "pi-agent-core 如何非侵入式接入 NiceEval",
      sidebarTitle: "pi-agent-core 如何接入",
      description:
        "一个 pi-agent-core(@earendil-works)助手后端，接入 NiceEval 前后的完整代码 diff：应用侧只加了一个 devDependency。",
    },
    intro: [
      "对比对象：",
      "",
      "- **before**：[https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/origin/pi-sdk](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/origin/pi-sdk) —— 独立的 `@earendil-works/pi-agent-core` HTTP 服务，还没接任何 eval。",
      "- **after**：[https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/tier1/pi-sdk](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/tier1/pi-sdk) —— 同一个应用接入 NiceEval 之后的样子。",
      "",
      "**接入方式**：官方转换器——pi 原生 `AgentEvent` → 标准事件的映射是",
      "`fromPiAgentEvents`（`\"niceeval/adapter\"` 导出）的事，adapter 只剩传输粘合：",
      "应用在哪个 URL、审批打哪个端点（`calculate` 工具走 HITL 审批）。应用由你自己按它的",
      "方式启动（`pnpm start`），eval 不代管进程。应用侧 `src/backend/*` 逐字节未变。",
    ].join("\n"),
    order: ["package.json", "tsconfig.json", "pnpm-workspace.yaml", "niceeval.config.ts", "agents/", "evals/", "experiments/"],
    sections: [
      { title: "应用侧的变更(只有依赖声明)", files: ["package.json", "tsconfig.json", "pnpm-workspace.yaml"] },
      { title: "新增的 adapter、evals 与 experiments", files: ["niceeval.config.ts", "agents/", "evals/", "experiments/"] },
    ],
    statGroups: TIER1_STAT_GROUPS,
    exclude: ["README.md", ".env.example"],
  },
  {
    source: "examples/zh/origin/claude-sdk",
    target: "examples/zh/tier1/claude-sdk",
    out: "docs-site/zh/example/tier1-claude-sdk.mdx",
    frontmatter: {
      title: "Claude Agent SDK 如何非侵入式接入 NiceEval",
      sidebarTitle: "Claude Agent SDK 如何接入",
      description:
        "一个 Claude Agent SDK 助手后端，接入 NiceEval 前后的完整代码 diff：应用侧一行没改，全部新增在 eval 侧。",
    },
    intro: [
      "对比对象：",
      "",
      "- **before**：[https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/origin/claude-sdk](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/origin/claude-sdk) —— 独立的 `@anthropic-ai/claude-agent-sdk` HTTP 服务，还没接任何 eval。",
      "- **after**：[https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/tier1/claude-sdk](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/tier1/claude-sdk) —— 同一个应用接入 NiceEval 之后的样子。",
      "",
      "**接入方式**：官方转换器——Claude Agent SDK 原生 `SDKMessage` → 标准事件的映射是",
      "`fromClaudeSdkMessages`（`\"niceeval/adapter\"` 导出）的事，adapter 只剩传输粘合与",
      "HITL 停轮判定（`calculate` 经官方 `canUseTool` 回调门控）。应用由你自己按它的方式启动",
      "（`pnpm start`），eval 不代管进程。应用侧 `src/backend/*` 逐字节未变。",
    ].join("\n"),
    order: ["package.json", "tsconfig.json", "pnpm-workspace.yaml", "niceeval.config.ts", "agents/", "evals/", "experiments/"],
    sections: [
      { title: "应用侧的变更(只有依赖声明)", files: ["package.json", "tsconfig.json", "pnpm-workspace.yaml"] },
      { title: "新增的 adapter、evals 与 experiments", files: ["niceeval.config.ts", "agents/", "evals/", "experiments/"] },
    ],
    statGroups: TIER1_STAT_GROUPS,
    exclude: ["README.md", ".env.example"],
  },
  {
    source: "examples/zh/origin/codex-sdk",
    target: "examples/zh/tier1/codex-sdk",
    out: "docs-site/zh/example/tier1-codex-sdk.mdx",
    frontmatter: {
      title: "Codex SDK 如何非侵入式接入 NiceEval",
      sidebarTitle: "Codex SDK 如何接入",
      description:
        "一个 Codex SDK（目录里的编码 agent）后端，接入 NiceEval 前后的完整代码 diff：应用侧一行没改。",
    },
    intro: [
      "对比对象：",
      "",
      "- **before**：[https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/origin/codex-sdk](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/origin/codex-sdk) —— 独立的 `@openai/codex-sdk` HTTP 服务，还没接任何 eval。",
      "- **after**：[https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/tier1/codex-sdk](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/tier1/codex-sdk) —— 同一个应用接入 NiceEval 之后的样子。",
      "",
      "**接入方式**：官方转换器——codex 原生 `ThreadEvent` → 标准事件的映射是",
      "`fromCodexThreadEvents`（`\"niceeval/adapter\"` 导出）的事：消息文本、工具项",
      "（`command_execution` / `mcp_tool_call` / `file_change` → 配对的 `action.*`）和",
      "`turn.completed` 的 usage 全部来自这条流，adapter 只剩传输粘合。没有 HITL",
      "（Codex SDK 不支持）。eval 测的是真实编码任务（在工作目录里写文件、跑命令），断言",
      "直接读磁盘验证。应用由你自己启动（`pnpm start`），eval 不代管进程。应用侧",
      "`src/backend/*` 逐字节未变。要 OTel 瀑布图见 `tier2/`，feature A/B 见 `tier3/`。",
    ].join("\n"),
    order: ["package.json", "tsconfig.json", "pnpm-workspace.yaml", "niceeval.config.ts", "agents/", "evals/", "experiments/"],
    sections: [
      { title: "应用侧的变更(只有依赖声明)", files: ["package.json", "tsconfig.json", "pnpm-workspace.yaml"] },
      { title: "新增的 adapter、evals 与 experiments", files: ["niceeval.config.ts", "agents/", "evals/", "experiments/"] },
    ],
    statGroups: TIER1_STAT_GROUPS,
    // workspace/ 是 Codex 落地编辑结果的 scratch 目录(已 gitignore),eval 一跑就会留下
    // 新文件;不排除的话运行残留会混进"应用侧一行没改"的 diff 页
    exclude: ["README.md", ".env.example", "workspace"],
  },
  {
    source: "examples/zh/origin/langgraph",
    target: "examples/zh/tier1/langgraph",
    out: "docs-site/zh/example/tier1-langgraph.mdx",
    frontmatter: {
      title: "LangGraph 如何非侵入式接入 NiceEval",
      sidebarTitle: "LangGraph 如何接入",
      description:
        "一个纯 Python LangGraph + LangSmith OTel 导出的应用，接入 NiceEval 前后的完整代码 diff。",
    },
    intro: [
      "对比对象：",
      "",
      "- **before**：[https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/origin/langgraph](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/origin/langgraph) —— 纯 Python 的 `create_agent`（LangChain 1.x / LangGraph）HTTP 服务，还没接任何 eval。",
      "- **after**：[https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/tier1/langgraph](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/tier1/langgraph) —— 同一个应用接入 NiceEval 之后的样子。",
      "",
      "**接入方式**：手写帧映射——server.py 的自定义 JSON 帧逐帧翻成标准事件（`tool-input` →",
      "`action.called`、`tool-output` → `action.result`、`text-delta` 累积成 `message`、",
      "`tool-approval-request` → 停轮 + `input.requested`），HITL 停轮现场的存取走 `ctx.session`。",
      "被测应用是 Python，eval 侧是另起的独立 TS 项目，应用侧 `src/backend/*.py` 逐字节未变。",
      "要 OTel 瀑布图见 `tier2/`，feature A/B 见 `tier3/`。",
    ].join("\n"),
    order: ["package.json", "tsconfig.json", "pnpm-workspace.yaml", "niceeval.config.ts", "agents/", "evals/", "experiments/"],
    sections: [
      { title: "新增的 TS 侧脚手架(应用本身零改动)", files: ["package.json", "tsconfig.json", "pnpm-workspace.yaml"] },
      { title: "新增的 adapter、evals 与 experiments", files: ["niceeval.config.ts", "agents/", "evals/", "experiments/"] },
    ],
    // 被测应用是 Python,origin 侧没有这三个文件——它们是 eval 侧全新的 TS 项目脚手架,
    // 不是"往应用配置里加依赖声明",所以第一类的说法和其它四个不同
    statGroups: [
      { label: "eval 侧 TS 项目脚手架（必要：被测应用是 Python，全新文件）", files: ["package.json", "tsconfig.json", "pnpm-workspace.yaml"] },
      ...TIER1_STAT_GROUPS.slice(1),
    ],
    exclude: ["README.md", ".env.example"],
  },
  {
    source: "examples/zh/origin/ai-sdk-v7",
    target: "examples/zh/tier1/ai-sdk-v7",
    out: "docs-site/zh/example/tier1-ai-sdk-v7.mdx",
    frontmatter: {
      title: "AI SDK v7 如何非侵入式接入 NiceEval",
      sidebarTitle: "AI SDK v7 如何接入",
      description:
        "一个 AI SDK v7 聊天应用，对着它的 HTTP 接口无侵入接入 NiceEval 前后的完整代码 diff：应用侧一行没改。",
    },
    intro: [
      "对比对象：",
      "",
      "- **before**：[https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/origin/ai-sdk-v7](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/origin/ai-sdk-v7) —— 普通的 AI SDK v7 聊天应用（HTTP 服务器 + React 聊天 UI），还没接任何 eval。",
      "- **after**：[https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/tier1/ai-sdk-v7](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/tier1/ai-sdk-v7) —— 同一个应用接入 NiceEval 之后的样子。",
      "",
      "**接入方式**：内置 **`uiMessageStreamAgent`**——AI SDK UI Message Stream 协议（`useChat`",
      "后端的标准 SSE）的官方无侵入 adapter，adapter 文件只剩配置：端点在哪、请求体怎么带",
      "`model`。会话重放、HITL 审批（`needsApproval` 工具的 part 改写重发）、工具/消息事件",
      "从协议帧直构，全是工厂内置行为；协议帧里没有 usage，这个示例没有用量断言。应用侧",
      "`src/backend/*` 逐字节未变。要 OTel 瀑布图见 `tier2/`，feature A/B 见 `tier3/`。",
    ].join("\n"),
    order: ["package.json", "tsconfig.json", "pnpm-workspace.yaml", "niceeval.config.ts", "agents/", "evals/", "experiments/"],
    sections: [
      { title: "应用侧的变更(只有依赖声明)", files: ["package.json", "tsconfig.json", "pnpm-workspace.yaml"] },
      { title: "新增的 adapter、evals 与 experiments", files: ["niceeval.config.ts", "agents/", "evals/", "experiments/"] },
    ],
    statGroups: TIER1_STAT_GROUPS,
    exclude: ["README.md", ".env.example"],
  },
  // openllmetry / openinference 的 before-after 配置连同两个示例目录一起移除了
  // (2026-07,待 langgraph 那批做完后重做,见 examples/README.md)。2026-07 langgraph 那批
  // 已做完(examples/zh/tier1/*),上面五个配置已按 docs/origin-integration.md 重做。
];

// 与学习无关的目录/文件，不进 diff
const EXCLUDES = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.venv(\/|$)/,
  /(^|\/)__pycache__(\/|$)/,
  /(^|\/)\.niceeval(\/|$)/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)\.env$/,
  /(^|\/)\.DS_Store$/,
];

type Status = "新增" | "修改" | "删除";

function listFiles(dir: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (EXCLUDES.some((re) => re.test(rel))) continue;
    if (entry.isDirectory()) files.push(...listFiles(dir, rel));
    else if (entry.isFile()) files.push(rel);
  }
  return files;
}

function rank(file: string, order: string[]): number {
  const i = order.findIndex((prefix) => file === prefix || file.startsWith(prefix));
  return i === -1 ? order.length : i;
}

function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8192).includes(0);
}

function shikiLang(file: string): string {
  if (/\.tsx?$/.test(file)) return "typescript";
  if (/\.json$/.test(file)) return "json";
  if (/\.ya?ml$/.test(file)) return "yaml";
  if (/\.mdx?$/.test(file)) return "markdown";
  if (/\.m?js$/.test(file)) return "javascript";
  if (/\.env(\.|$)/.test(basename(file))) return "ini";
  return "txt";
}

// ---- diff（纯实现，避免依赖外部 diff 命令或库）----

type Op = { t: " " | "-" | "+"; line: string };

function diffOps(a: string[], b: string[]): Op[] {
  // LCS 动态规划；示例文件都在几百行以内，O(n·m) 足够
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: " ", line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ t: "-", line: a[i++] });
    else ops.push({ t: "+", line: b[j++] });
  }
  while (i < n) ops.push({ t: "-", line: a[i++] });
  while (j < m) ops.push({ t: "+", line: b[j++] });
  return ops;
}

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** 完整文件的 diff op 序列：像 GitHub PR 展开全部行那样展示，不截 hunk 上下文 */
function fullFileOps(beforeText: string, afterText: string): Op[] {
  return diffOps(splitLines(beforeText), splitLines(afterText));
}

// ---- Shiki 高亮：token → 调色板 class，颜色集中到生成的 CSS 里 ----

/** `${light}|${dark}` → class 名，跨所有文件共享，调色板很小（十几个） */
const palette = new Map<string, string>();

/** 折叠区的全局唯一 id 计数 */
let foldSeq = 0;

function tokenClass(token: ThemedToken): string | undefined {
  const style = token.htmlStyle as Record<string, string> | undefined;
  const light = style?.color;
  const dark = style?.["--shiki-dark"];
  if (!light && !dark) return undefined;
  const key = `${light ?? ""}|${dark ?? ""}`;
  let cls = palette.get(key);
  if (!cls) {
    cls = `gdt${palette.size}`;
    palette.set(key, cls);
  }
  return cls;
}

/** 整个文件一次性 tokenize（保住多行结构：模板字符串、块注释），返回逐行 JSX */
async function highlightLines(text: string, lang: string): Promise<string[]> {
  const { tokens } = await codeToTokens(text.replace(/\n$/, ""), {
    lang: lang as never,
    themes: { light: "github-light", dark: "github-dark" },
  });
  return tokens.map((line) => {
    if (line.length === 0) return jsxText(" ");
    return line
      .map((token) => {
        if (token.content === "") return "";
        const cls = tokenClass(token);
        return cls ? `<span className="${cls}">${jsxText(token.content)}</span>` : jsxText(token.content);
      })
      .join("");
  });
}

/** MDX 里最稳的转义方式：包成 JS 字符串字面量表达式 */
function jsxText(text: string): string {
  return `{${JSON.stringify(text)}}`;
}

// ---- 文件树 ----

interface TreeNode {
  children: Map<string, TreeNode>;
  status?: Status;
}

function renderTree(entries: Array<{ file: string; status: Status }>, rootLabel: string, order: string[]): string {
  const root: TreeNode = { children: new Map() };
  for (const { file, status } of entries) {
    let node = root;
    for (const part of file.split("/")) {
      let child = node.children.get(part);
      if (!child) {
        child = { children: new Map() };
        node.children.set(part, child);
      }
      node = child;
    }
    node.status = status;
  }

  // 节点排序：按其下所有文件的最小阅读顺序，其次按名字
  const nodeRank = (node: TreeNode, path: string): number => {
    if (node.children.size === 0) return rank(path, order);
    return Math.min(...[...node.children].map(([name, child]) => nodeRank(child, `${path}/${name}`.replace(/^\//, ""))));
  };

  const rows: Array<[string, string]> = [[`${rootLabel}/`, ""]];
  const walk = (node: TreeNode, path: string, indent: string) => {
    const children = [...node.children].sort(([na, a], [nb, b]) => {
      const pa = path ? `${path}/${na}` : na;
      const pb = path ? `${path}/${nb}` : nb;
      return nodeRank(a, pa) - nodeRank(b, pb) || na.localeCompare(nb);
    });
    children.forEach(([name, child], i) => {
      const isLast = i === children.length - 1;
      const childPath = path ? `${path}/${name}` : name;
      const label = child.children.size > 0 ? `${name}/` : name;
      rows.push([`${indent}${isLast ? "└── " : "├── "}${label}`, child.status ?? ""]);
      walk(child, childPath, indent + (isLast ? "    " : "│   "));
    });
  };
  walk(root, "", "");

  const width = Math.max(...rows.map(([tree]) => tree.length));
  return rows.map(([tree, status]) => (status ? `${tree.padEnd(width + 3)}${status}` : tree)).join("\n");
}

// ---- GitHub PR 式 diff 表格 ----

interface FileDiff {
  html: string[];
  /** 变更行数（二进制文件计 0），供页面开头的自动统计用 */
  adds: number;
  dels: number;
}

async function renderFileDiff(pair: DiffPair, file: string, status: Status): Promise<FileDiff> {
  const before = status === "新增" ? Buffer.alloc(0) : readFileSync(join(ROOT, pair.source, file));
  const after = status === "删除" ? Buffer.alloc(0) : readFileSync(join(ROOT, pair.target, file));

  // Mintlify 会剥掉 <details>/<summary>，只能用 div（不做折叠）
  const head = (extra: string) =>
    `<div className="gd-head"><span className="gd-name">${jsxText(file)}</span>${extra}</div>`;

  if (isBinary(before) || isBinary(after)) {
    const size = status === "删除" ? before.length : after.length;
    return {
      html: [
        `<div className="gd-file">`,
        head(`<span className="gd-stats">${jsxText("BIN")}</span>`),
        `<div className="gd-note">${jsxText(`二进制文件，${size} bytes，略`)}</div>`,
        `</div>`,
      ],
      adds: 0,
      dels: 0,
    };
  }

  const lang = shikiLang(file);
  const beforeLines = await highlightLines(before.toString("utf8"), lang);
  const afterLines = await highlightLines(after.toString("utf8"), lang);
  // 展示机制：完整文件全部行（像 GitHub PR 展开全部），变更行红绿标注，
  // 不截 hunk 上下文，也就没有 @@ 行
  const ops = fullFileOps(before.toString("utf8"), after.toString("utf8"));

  const adds = ops.filter((o) => o.t === "+").length;
  const dels = ops.filter((o) => o.t === "-").length;
  const stats =
    `<span className="gd-stats">` +
    (adds ? `<span className="gd-plus">${jsxText(`+${adds}`)}</span>` : "") +
    (dels ? `<span className="gd-minus">${jsxText(`−${dels}`)}</span>` : "") +
    `</span>`;

  // 折叠：离最近变更行超过 FOLD_CONTEXT 的上下文行默认隐藏，像 GitHub 一样
  // 用蓝色展开条占位（点击展开由 github-diff.js 处理）；藏的行太少就不折
  const dist = new Array<number>(ops.length).fill(Number.POSITIVE_INFINITY);
  {
    let last = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < ops.length; k++) {
      if (ops[k].t !== " ") last = k;
      dist[k] = k - last;
    }
    let next = Number.POSITIVE_INFINITY;
    for (let k = ops.length - 1; k >= 0; k--) {
      if (ops[k].t !== " ") next = k;
      dist[k] = Math.min(dist[k], next - k);
    }
  }
  const hide = dist.map((d) => d > FOLD_CONTEXT);
  for (let k = 0; k < ops.length; ) {
    if (!hide[k]) {
      k++;
      continue;
    }
    let j = k;
    while (j < ops.length && hide[j]) j++;
    if (j - k < FOLD_MIN_HIDDEN) for (let x = k; x < j; x++) hide[x] = false;
    k = j;
  }

  const rows: string[] = [];
  let aLine = 1;
  let bLine = 1;
  const pushRow = (op: Op, extraClass = "") => {
    // 上下文行和 + 行取 after 的高亮，- 行取 before 的高亮
    const code = op.t === "-" ? beforeLines[aLine - 1] : afterLines[bLine - 1];
    const cells =
      op.t === "+"
        ? `<td className="gd-ln"></td><td className="gd-ln">${jsxText(String(bLine))}</td><td className="gd-sign">${jsxText("+")}</td>`
        : op.t === "-"
          ? `<td className="gd-ln">${jsxText(String(aLine))}</td><td className="gd-ln"></td><td className="gd-sign">${jsxText("−")}</td>`
          : `<td className="gd-ln">${jsxText(String(aLine))}</td><td className="gd-ln">${jsxText(String(bLine))}</td><td className="gd-sign"></td>`;
    const base = op.t === "+" ? "gd-add" : op.t === "-" ? "gd-del" : "";
    const cls = [base, extraClass].filter(Boolean).join(" ");
    rows.push(`<tr${cls ? ` className="${cls}"` : ""}>${cells}<td className="gd-code">${code ?? jsxText(" ")}</td></tr>`);
    if (op.t !== "+") aLine++;
    if (op.t !== "-") bLine++;
  };

  for (let k = 0; k < ops.length; ) {
    if (!hide[k]) {
      pushRow(ops[k]);
      k++;
      continue;
    }
    let j = k;
    while (j < ops.length && hide[j]) j++;
    const id = `gdf${foldSeq++}`;
    rows.push(
      `<tr className="gd-expand" data-fold="${id}"><td className="gd-ln" colSpan={2}>${jsxText("⇕")}</td><td className="gd-sign"></td><td className="gd-code">${jsxText(`展开 ${j - k} 行未变更代码`)}</td></tr>`,
    );
    for (; k < j; k++) pushRow(ops[k], `gd-fold ${id}`);
  }

  return {
    html: [
      `<div className="gd-file">`,
      head(stats),
      `<div className="gd-body">`,
      // table 内部不能出现空白文本节点（React 对 <tbody> 里的文本会 hydration 失败、
      // 整块丢弃），所以所有行拼成一行、标签间零空白
      `<table className="gd-table"><tbody>${rows.join("")}</tbody></table>`,
      `</div>`,
      `</div>`,
    ],
    adds,
    dels,
  };
}

// ---- MDX 生成 ----

async function generate(pair: DiffPair): Promise<void> {
  const excluded = (f: string) => pair.exclude?.some((p) => f === p || f.startsWith(`${p}/`)) ?? false;
  const beforeFiles = new Set(listFiles(pair.source).filter((f) => !excluded(f)));
  const afterFiles = new Set(listFiles(pair.target).filter((f) => !excluded(f)));

  const entries: Array<{ file: string; status: Status }> = [];
  for (const f of afterFiles) {
    if (!beforeFiles.has(f)) entries.push({ file: f, status: "新增" });
    else if (!readFileSync(join(ROOT, pair.source, f)).equals(readFileSync(join(ROOT, pair.target, f)))) {
      entries.push({ file: f, status: "修改" });
    }
  }
  for (const f of beforeFiles) {
    if (!afterFiles.has(f)) entries.push({ file: f, status: "删除" });
  }
  entries.sort((a, b) => rank(a.file, pair.order) - rank(b.file, pair.order) || a.file.localeCompare(b.file));

  const rendered: Array<{ file: string; status: Status; diff: FileDiff }> = [];
  for (const e of entries) rendered.push({ ...e, diff: await renderFileDiff(pair, e.file, e.status) });

  const lines: string[] = [];
  lines.push("---");
  lines.push(`title: "${pair.frontmatter.title}"`);
  if (pair.frontmatter.sidebarTitle) lines.push(`sidebarTitle: "${pair.frontmatter.sidebarTitle}"`);
  lines.push(`description: "${pair.frontmatter.description}"`);
  lines.push("---");
  lines.push("");
  lines.push(`{/* 本文件由 scripts/gen-diff-code.ts 生成（pnpm run gen:diff-code），不要手工编辑 */}`);
  lines.push("");
  lines.push(pair.intro);
  lines.push("");

  // 变更统计从两个目录的实际 diff 计算,不是手写数字。文件按最长匹配前缀归组,
  // 归不进任何组的落进"其它"(正常不该出现,出现说明 statGroups 漏配了)
  const groupOf = (file: string): number => {
    let best = pair.statGroups.length; // 兜底:其它
    let bestLen = -1;
    pair.statGroups.forEach((g, gi) => {
      for (const p of g.files) {
        if ((file === p || file.startsWith(p)) && p.length > bestLen) {
          best = gi;
          bestLen = p.length;
        }
      }
    });
    return best;
  };
  const fmtLines = (adds: number, dels: number) =>
    [adds ? `+${adds}` : "", dels ? `−${dels}` : ""].filter(Boolean).join(" ") || "0";
  lines.push("接入的全部代码变更（生成时从两个目录实测统计）：");
  lines.push("");
  // 统计表必须用 JSX 表格,不能用 markdown 管道表:同一页里出现 GFM 表格 + diff 的超长
  // 单行 JSX 时,MDX 编译直接 Maximum call stack size exceeded(实测,五页全挂),
  // 见 memory/mintlify-mdx-html-rendering-limits.md
  const statRows: string[] = [
    `<tr><th>${jsxText("类别")}</th><th>${jsxText("文件数")}</th><th>${jsxText("行数")}</th></tr>`,
  ];
  let totalN = 0;
  let totalAdds = 0;
  let totalDels = 0;
  for (let gi = 0; gi <= pair.statGroups.length; gi++) {
    const rs = rendered.filter((r) => groupOf(r.file) === gi);
    if (rs.length === 0) continue;
    const adds = rs.reduce((a, r) => a + r.diff.adds, 0);
    const dels = rs.reduce((a, r) => a + r.diff.dels, 0);
    totalN += rs.length;
    totalAdds += adds;
    totalDels += dels;
    const label = gi < pair.statGroups.length ? pair.statGroups[gi].label : "其它";
    statRows.push(
      `<tr><td>${jsxText(label)}</td><td>${jsxText(String(rs.length))}</td><td>${jsxText(fmtLines(adds, dels))}</td></tr>`,
    );
  }
  statRows.push(
    `<tr className="gd-total"><td>${jsxText("合计")}</td><td>${jsxText(String(totalN))}</td><td>${jsxText(fmtLines(totalAdds, totalDels))}</td></tr>`,
  );
  lines.push(`<table className="gd-summary"><tbody>${statRows.join("")}</tbody></table>`);
  lines.push("");

  lines.push("## 文件清单");
  lines.push("");
  lines.push("```text");
  lines.push(renderTree(entries, basename(pair.target), pair.order));
  lines.push("```");
  lines.push("");

  const sectionOf = (file: string): number => {
    const i = pair.sections.findIndex((s) => s.files.some((prefix) => file === prefix || file.startsWith(prefix)));
    return i === -1 ? pair.sections.length - 1 : i;
  };

  for (let si = 0; si < pair.sections.length; si++) {
    const sectionEntries = rendered.filter((e) => sectionOf(e.file) === si);
    if (sectionEntries.length === 0) continue;
    lines.push(`## ${pair.sections[si].title}`);
    lines.push("");
    for (const { diff } of sectionEntries) {
      lines.push(...diff.html);
      lines.push("");
    }
  }

  const outPath = join(ROOT, pair.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, lines.join("\n"));
  const counts = { 新增: 0, 修改: 0, 删除: 0 };
  for (const e of entries) counts[e.status]++;
  console.log(`已生成 ${pair.out}（新增 ${counts.新增}，修改 ${counts.修改}，删除 ${counts.删除}）`);
}

// ---- CSS 生成（GitHub PR 配色，浅色 + .dark 深色）----

function writeCss(): void {
  const scaffold = `/* 本文件由 scripts/gen-diff-code.ts 生成（pnpm run gen:diff-code），不要手工编辑 */
/* GitHub PR 式 diff 视图，配合生成的 diff MDX 页面使用 */

.gd-file {
  margin: 1rem 0;
  border: 1px solid #d0d7de;
  border-radius: 8px;
  overflow: hidden;
  font-size: 12px;
}
.dark .gd-file { border-color: #30363d; }

.gd-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #f6f8fa;
  border-bottom: 1px solid #d0d7de;
  user-select: none;
}
.dark .gd-head { background: #161b22; border-bottom-color: #30363d; }

.gd-name {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-weight: 600;
  color: #1f2328;
}
.dark .gd-name { color: #e6edf3; }

.gd-stats { margin-left: auto; font-weight: 600; display: flex; gap: 6px; }
.gd-plus { color: #1a7f37; }
.gd-minus { color: #cf222e; }
.dark .gd-plus { color: #3fb950; }
.dark .gd-minus { color: #f85149; }

.gd-body { overflow-x: auto; background: #ffffff; }
.dark .gd-body { background: #0d1117; }

.gd-note { padding: 12px; color: #656d76; background: #ffffff; }
.dark .gd-note { color: #8b949e; background: #0d1117; }

table.gd-table {
  width: 100%;
  margin: 0;
  border-collapse: collapse;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 12px;
  line-height: 20px;
  display: table;
}
.gd-table tr { border: 0; background: transparent; }
.gd-table td { border: 0; padding: 0; background: transparent; }

td.gd-ln {
  width: 1%;
  min-width: 40px;
  padding: 0 10px;
  text-align: right;
  color: #656d76;
  user-select: none;
  vertical-align: top;
}
.dark td.gd-ln { color: #6e7681; }

td.gd-sign {
  width: 1%;
  padding: 0 4px;
  text-align: center;
  user-select: none;
  color: #1f2328;
  vertical-align: top;
}
.dark td.gd-sign { color: #e6edf3; }

td.gd-code {
  padding: 0 10px 0 4px;
  white-space: pre;
  color: #1f2328;
  tab-size: 2;
}
.dark td.gd-code { color: #e6edf3; }

/* 背景挂在 td 而不是 tr 上：tr 背景在 Safari / 非整数缩放下行间会出 hairline */
tr.gd-add td { background: #e6ffec; }
tr.gd-add td.gd-ln { background: #ccffd8; }
.dark tr.gd-add td { background: rgba(46, 160, 67, 0.15); }
.dark tr.gd-add td.gd-ln { background: rgba(63, 185, 80, 0.3); color: #c9d1d9; }

tr.gd-del td { background: #ffebe9; }
tr.gd-del td.gd-ln { background: #ffd7d5; }
.dark tr.gd-del td { background: rgba(248, 81, 73, 0.1); }
.dark tr.gd-del td.gd-ln { background: rgba(248, 81, 73, 0.3); color: #c9d1d9; }

/* 页面开头的变更统计表（JSX 表格：同页有超长 JSX 行时 GFM 管道表格会压爆 MDX 编译栈） */
table.gd-summary { border-collapse: collapse; margin: 1rem 0; font-size: 14px; display: table; width: auto; }
.gd-summary th, .gd-summary td { border: 1px solid #d0d7de; padding: 6px 12px; text-align: left; background: transparent; }
.gd-summary th { background: #f6f8fa; font-weight: 600; }
.gd-summary th:nth-child(n+2), .gd-summary td:nth-child(n+2) { text-align: right; font-variant-numeric: tabular-nums; }
tr.gd-total td { font-weight: 600; background: #f6f8fa; }
.dark .gd-summary th, .dark .gd-summary td { border-color: #30363d; }
.dark .gd-summary th { background: #161b22; }
.dark tr.gd-total td { background: #161b22; }

/* 折叠的未变更行 + GitHub 式蓝色展开条（点击逻辑在 github-diff.js） */
tr.gd-fold { display: none; }
tr.gd-expand { cursor: pointer; }
tr.gd-expand td { background: #ddf4ff; }
tr.gd-expand td.gd-ln { color: #0969da; text-align: center; }
tr.gd-expand td.gd-code { color: #57606a; }
tr.gd-expand:hover td { background: #b6e3ff; }
.dark tr.gd-expand td { background: rgba(56, 139, 253, 0.15); }
.dark tr.gd-expand td.gd-ln { color: #58a6ff; }
.dark tr.gd-expand td.gd-code { color: #8b949e; }
.dark tr.gd-expand:hover td { background: rgba(56, 139, 253, 0.3); }
`;

  const paletteCss = [...palette.entries()]
    .map(([key, cls]) => {
      const [light, dark] = key.split("|");
      const rules: string[] = [];
      if (light) rules.push(`.${cls} { color: ${light}; }`);
      if (dark) rules.push(`.dark .${cls} { color: ${dark}; }`);
      return rules.join("\n");
    })
    .join("\n");

  writeFileSync(join(ROOT, CSS_OUT), `${scaffold}\n/* Shiki 调色板（github-light / github-dark） */\n${paletteCss}\n`);
  console.log(`已生成 ${CSS_OUT}（调色板 ${palette.size} 色）`);

  const js = `// 本文件由 scripts/gen-diff-code.ts 生成（pnpm run gen:diff-code），不要手工编辑
// GitHub 式 diff 展开条：点击后显示折叠的未变更行（配合 github-diff.css 的 .gd-fold）
document.addEventListener("click", (e) => {
  const tr = e.target && e.target.closest ? e.target.closest("tr.gd-expand") : null;
  if (!tr) return;
  const id = tr.getAttribute("data-fold");
  const tbody = tr.closest("tbody");
  if (!id || !tbody) return;
  tbody.querySelectorAll("tr." + id).forEach((row) => row.classList.remove("gd-fold"));
  tr.remove();
});
`;
  writeFileSync(join(ROOT, JS_OUT), js);
  console.log(`已生成 ${JS_OUT}`);
}

for (const pair of PAIRS) await generate(pair);
writeCss();
