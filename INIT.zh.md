# niceeval 安装向导（给 AI 读的执行步骤）

你正在被要求把 [niceeval](https://github.com/CorrectRoadH/niceeval) 接入**当前打开的这个仓库**（不是 niceeval 自己的源码仓库）。本文件只给步骤和决策点，不复述具体写法——每一步该怎么写，跟着链接去读 niceeval 的官方文档（`https://niceeval.com/docs/zh/...`）或 GitHub 上的 raw 文档，不要凭训练记忆里的旧 API 现编。

## 第 0 步：建立心智模型

niceeval 是一个 TypeScript evals 库：用声明式 API 定义"什么是好结果"，再施加到 coding agent、已部署的 agent/服务、或一个纯函数上。先读一遍，别跳：

- 概览与设计意图：https://niceeval.com/docs/zh/concepts/overview
- 5 分钟接入路径：https://niceeval.com/docs/zh/quickstart

核心心智模型只有三条，记住就够用：

1. 三个文件各管一件事——**adapter**（怎么连被测对象）、**experiment**（评谁、用什么配置跑几次）、**eval**（发什么输入、断言什么）。
2. niceeval **不定义任何 agent 协议**。连你自己的服务，adapter 里就是发一个普通 HTTP 请求；URL、鉴权是 adapter 的工厂参数，不是 niceeval 的配置项。
3. CLI 位置参数只用来筛"跑哪些 eval"（按 id 前缀）。选"对着哪个 agent/model 跑"永远是 flag 或 experiment 文件，不要把 URL、agent 名塞进位置参数。

## 第 1 步：确认前置条件

- 被测对象可以是任何语言/平台（iOS、Python 服务、别的什么都行）——niceeval 只要求本机有 Node，能跑 `npx`/`pnpm exec` 这类命令；adapter/experiment/eval 这三件套本身是 TS 文件，但不要求整个仓库是 TS/JS 项目。如果当前仓库没有 `package.json`，就地新建一个（或放进一个子目录）承载这三件套即可，不用因为宿主项目是别的语言就停下。
- 真正的前提只有：本机能装 Node 依赖、能跑 Node 命令。如果确认连这个都不满足，才如实告诉用户并停下来等决定。
- 检查是否已经装过：有没有 `niceeval.config.ts`、`evals/` 目录、`package.json` 里的 `niceeval` 依赖。已经装过的话，跳到第 4 步按现有结构补文件，不要重复 `init`。
- 探测包管理器（看 `pnpm-lock.yaml` / `package-lock.json` / `yarn.lock`），后面所有命令都用探测到的那个，不要默认 npm。

## 第 2 步：先探索项目，再和用户确认

这一步决定后面整条路径。**先自己读代码探明，把探到的结论列给用户核对，探不到的再提问**——不要一上来就抛一串问题，也不要没探就假设。要探明的信息：

1. **这是个什么 agent**：读 README、`package.json` 依赖、路由和 agent loop 代码，判断它是用什么写的（AI SDK、LangGraph、OpenAI Agents SDK、Claude Agent SDK、自研 loop……），核心用例是什么（客服？SQL？编码任务？）。
2. **前端和 agent 怎么通信**：HTTP 还是 gRPC / WebSocket？协议是标准的还是自己实现的——AI SDK UI Message Stream、OpenAI Responses / Chat Completions 这类标准协议，还是 SDK 原生事件流透传，还是用户自定义的 JSON/SSE 帧？这直接决定 adapter 是用内置的（零映射）还是手写 `send`（要自己写事件映射）。
3. **后端有没有接 OTel**：搜有没有 OTel SDK 初始化、AI SDK telemetry、LangSmith / OpenLLMetry / OpenInference 这类埋点。已经有的话 Tier 2 几乎零成本。
4. **用户自己有没有做 A/B Test / feature flag**：应用里已有变体开关的话，experiment 的 `flags` 可以直接透传给它（Tier 3 的现成入口）。
5. **judge 用什么**：语义评分（`t.judge.autoevals.*`）要一个**与被测 agent 分离的评判模型**，走 OpenAI 兼容的 `/chat/completions` 协议——OpenAI 官方、DeepSeek、任何兼容该协议的网关都行。问用户手上有哪个服务的 key、想用什么评判模型（没有内置默认模型，必须显式指定）。用户暂时没有 key 也不阻塞：judge 断言会静默跳过，先用精确断言跑通。
6. **是不是 agent 本体要进 sandbox**：被测对象是 coding agent CLI、或给 coding agent 写的 Skill/Plugin/Hook/MCP server（要在隔离 workspace 里改文件/跑命令）的话，必须走 sandbox，不能像 HTTP 服务那样直接 `send`。默认建议 `dockerSandbox()`，但**要先跟用户确认**——本机/CI 有没有 Docker、要不要 Vercel Sandbox 或其它云端后端；用户没有异议就默认走 Docker。sandbox 后端只能写在代码里（experiment 或 `niceeval.config.ts` 的 `sandbox` 字段），没有 CLI flag，也不会自动探测——见 https://niceeval.com/docs/zh/guides/sandbox-backends 。

探完之后，向用户**介绍接入的 Tier 模型**并给出推荐（详见 https://niceeval.com/docs/zh/concepts/tier ）：

- **Tier 1（只接 send）**：应用一行不改，全套断言（文本、judge、多轮、工具、HITL）都在这一档。
- **Tier 2（send + OTel）**：应用把 OTel span 也发 niceeval 一份，换 `niceeval view` 的调用瀑布图；已有埋点（第 3 点探到的）就零改动。
- **Tier 3（侵入改造 + flags）**：把应用内部变体暴露成 `flags` 做 feature A/B；已有 A/B 开关（第 4 点探到的）就是现成入口。

**默认推荐先 Tier 1 跑通，再升 Tier 2**——尤其当第 3 点探到应用已有 OTel 时，明确告诉用户"升 Tier 2 只是把 span 多发一份，成本接近零"。Tier 3 只在用户明确要做变体对比时提。

按探明的形态挑对应文档，不要在没读的情况下直接开始写 adapter：

| 被测对象 | 去读 |
|---|---|
| 用 Vercel AI SDK（`useChat` 后端）写的应用 | https://niceeval.com/docs/zh/reference/builtin-agents（内置 `uiMessageStreamAgent` 无侵入接入，不用手写事件映射） |
| coding agent CLI（claude-code / codex / bub 等改文件的任务） | https://niceeval.com/docs/zh/guides/sandbox-agent（要配 `sandbox`，默认 `dockerSandbox()`，先跟用户确认后端） |
| 给 Claude Code / Codex 写的 Skill | https://niceeval.com/docs/zh/example/claude-code-codex-skill（同样跑在 sandbox 里，后端确认方式同上） |
| 给 Claude Code / Codex 写的 Plugin/Hook/MCP server | https://niceeval.com/docs/zh/example/claude-code-codex-plugin（同样跑在 sandbox 里，后端确认方式同上） |
| 其它自研 agent loop、LangGraph、OpenAI Agents SDK、已部署 agent | https://niceeval.com/docs/zh/guides/connect-your-agent 起步，手写 send 的完整教程在 https://niceeval.com/docs/zh/guides/write-send |
| 纯函数、没有独立服务的场景 | 先读 https://niceeval.com/docs/zh/guides/connect-your-agent 里"为什么不直调"那段，跟用户确认这确实是他们要的边缘用法，再继续 |

## 第 3 步：安装

```sh
<你探测到的包管理器> add -D niceeval
<你探测到的包管理器> exec niceeval init
```

`init` 会生成 `niceeval.config.ts` 和 `evals/`。CLI 完整命令参考：https://niceeval.com/docs/zh/reference/cli

装完就把 judge 配上（第 2 步已问过用户用什么）。judge 走 **OpenAI 兼容的 `/chat/completions`** 协议，在 `niceeval.config.ts` 里配：

```ts
import { defineConfig } from "niceeval";

export default defineConfig({
  judge: {
    model: "gpt-5.4-mini",                // 必填：没有内置默认模型
    // 用非 OpenAI 官方的兼容服务（DeepSeek、网关等）时再加这两项：
    // baseUrl: "https://api.deepseek.com/v1",
    // apiKeyEnv: "DEEPSEEK_API_KEY",     // key 从这个环境变量读；不配默认读 OPENAI_API_KEY
  },
});
```

两个要提醒用户的点：

- **key 解析不到时 judge 断言会静默跳过**（不报错、不记分）——eval 全绿不代表 judge 真的跑了。所以配完先跑一条带 `t.judge` 的 eval，在 `niceeval view` 里确认有 judge 分数。
- 评判模型要**与被测 agent 分离**，避免同一个模型给自己打分。模型解析优先级（单次调用 → eval 级 → 全局配置）和三种评分形状见 https://niceeval.com/docs/zh/concepts/judge ；`judge` 字段的完整定义见 https://niceeval.com/docs/zh/reference/define-config 。

## 第 4 步：写三件套

按第 2 步选中的文档，依次写：

1. **adapter**（`agents/*.ts` 或用户项目里约定的目录）——只填 `defineAgent` 的 `send`，配置走工厂参数，不写死、不读 `process.env`。契约本身（`TurnInput` / `AgentContext` / `Turn` 逐字段）：https://niceeval.com/docs/zh/concepts/adapter ；API 签名：https://niceeval.com/docs/zh/reference/define-agent ；把响应映射成标准事件流（工具调用、多轮）：https://niceeval.com/docs/zh/reference/events 。
2. **experiment**（`experiments/*.ts`）——引用上面的 adapter，声明 `model`、`flags`、`runs` 等；被测对象是 agent 的话还要声明 `sandbox`（第 2 步已跟用户确认过的后端，默认 `dockerSandbox()`，从 `niceeval/sandbox` 导入）。**默认建一个实验组文件夹做模型对比**：`experiments/compare-models/` 下放两个文件，同一个 adapter、钉住一切、只差 `model` 各一个（比如 `compare-models/gpt-5.4.ts` 和 `compare-models/deepseek-v4-pro.ts`；`model` 是单个字符串，不接受数组）。跑一次 `niceeval exp compare-models` 就把组内各 model 并排出报告——这是 niceeval 最直观的价值演示。用哪两个模型要跟用户确认（应用支持哪些、有哪些 key）；应用接口不收模型参数的话退化成单个 experiment 文件，如实告诉用户原因。完整字段参考：https://niceeval.com/docs/zh/guides/write-experiment ；项目级配置（`niceeval.config.ts`）见 https://niceeval.com/docs/zh/reference/define-config 。
3. **eval**（`evals/*.eval.ts`）——**先探明这个应用是干嘛的，再写一条贴着它真实功能的 eval**：读它的 README、路由、工具定义或系统提示，找出它的核心用例（客服机器人就问一条真实的客服问题、SQL agent 就给一个真实的查询任务），拿这个用例做第一条 eval 的输入和断言，不要写"你好"这种和应用无关的占位输入。形式上仍从最小写起：一句输入，`t.succeeded()` + 一个针对预期回答的内容断言，跑通再加断言密度。`defineEval` 签名：https://niceeval.com/docs/zh/reference/define-eval ；断言写法与 `t.judge`：https://niceeval.com/docs/zh/guides/authoring 、https://niceeval.com/docs/zh/guides/scoring-guide ；内置断言库：https://niceeval.com/docs/zh/reference/expect 。

参数怎么从 experiment 流到 adapter、静态配置和每轮动态值怎么分（工厂参数 vs `ctx`），完整讲解见 https://niceeval.com/docs/zh/guides/connect-your-agent 。

架构上有两条硬规则，写 adapter 时不要违反：

- **不做进程内直调**。就算 agent runtime 和 eval 在同一个代码库里，adapter 也要走 HTTP（或对应传输层），不要把 `fetch` 换成直接 `import` 被测函数——原因见 connect-your-agent 里"为什么不直调"。
- **eval 侧不代管被测进程**。不 spawn 应用、不另开端口；应用由用户自己按平时的方式启动（`pnpm dev` 之类），adapter 连不上时报"先起应用"这类明确的错误，不要自己起服务。

## 第 5 步：跑通并验证

```sh
<包管理器> exec niceeval exp compare-models   # 跑实验组，组内各 model 并排出报告
<包管理器> exec niceeval view                 # 查看器里看对比结果
```

`niceeval view` 本地查看器怎么读：https://niceeval.com/docs/zh/guides/viewing-results 。没跑通按报错位置分三类排查（详细排查表见 https://niceeval.com/docs/zh/guides/connect-your-agent ）：`fetch` 直接抛错 → 应用没起来或 URL 不对；`t.succeeded()` 不过 → 应用回了非成功状态；只有内容断言不过 → 接入已经通了，调断言或调应用。

## 第 6 步：收尾，告诉用户做了什么

跑通之后先总结，再谈下一步。总结要说清：接了什么被测对象、生成了哪几个文件（adapter / experiments / evals 各在哪）、`niceeval exp compare-models` 和 `niceeval view` 怎么跑、第一次运行的结果是什么样。不要在没被要求的情况下顺手重构用户已有代码，也不要在这几个文件之外新增抽象。

## 第 7 步：问用户要不要往深了接

总结完之后，把还能往深接的选项列给用户——每一项都说清**能做什么、大概改多少代码、买到什么好处**，让用户自己选，不要自作主张多做：

| 能做什么 | 改动量 | 好处 | 文档 |
|---|---|---|---|
| 工具调用断言（`t.calledTool()` 等） | 只改 adapter：把应用响应映射成标准事件流，约 10–30 行映射代码 | eval 能断言"agent 有没有调对工具、参数对不对"，不再只看最终回复 | https://niceeval.com/docs/zh/guides/write-send 、https://niceeval.com/docs/zh/reference/events |
| 多轮对话、会话隔离 | 只改 adapter：接上 `ctx.session`（`history()` 或 `id` + `capture()`），几行到十几行 | eval 能写多轮场景、`t.newSession()` 验证会话间不串味 | https://niceeval.com/docs/zh/guides/write-send |
| 人工审批流（HITL） | 只改 adapter：停轮返回 `waiting` + `input.requested`，回答轮续跑，约 10–20 行 | eval 能覆盖"批准/拒绝之后 agent 行为对不对"这类审批场景 | https://niceeval.com/docs/zh/concepts/hitl |
| 调用瀑布图（升 Tier 2） | 应用已有 OTel 埋点（第 2 步探过）：只是把 span 多发一份给 niceeval，几行配置；没埋点：补一段通用 OTel 初始化 | `niceeval view` 里看到应用内部每次模型调用、工具执行的耗时和 token 时间线；不影响任何断言 | https://niceeval.com/docs/zh/guides/connect-otel |
| feature A/B 对比（升 Tier 3） | 改应用：把变体暴露成 `flags` 可切换的配置，改动量取决于应用；已有 A/B 开关（第 2 步探过）就是现成入口 | experiment 层面直接对比"改 prompt / 换工具集 / 开关 feature 谁更好" | https://niceeval.com/docs/zh/concepts/tier 、https://niceeval.com/docs/zh/concepts/experiment |

共同点也要讲给用户：这些全是给 adapter 或应用加增量，**已写的 eval 一行不用改**。三档投入分别买到什么、什么时候值得升级，见 https://niceeval.com/docs/zh/concepts/tier 。第 2 步探到应用已有 OTel 埋点的话，瀑布图那条要主动推荐——成本接近零。
