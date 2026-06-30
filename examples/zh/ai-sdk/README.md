# AI SDK Web Agent Example

这个例子演示一个用 AI SDK tool loop 实现的【普通 AI 助手】web agent，如何通过 `defineAgent` 接进 fasteval：发消息、调用工具（查天气 / 算数 / 搜索）、理解图片，都用同一套 eval surface 评测。

结构：

- `ai-sdk-agent/`：被测 web agent。它暴露 `POST /api/turn`，内部有 `get_weather`、`calculate`、`web_search` 三个工具，并支持图片理解（消息里带图片 URL 时走多模态视觉）。
- `ai-sdk-agent/langfuse/`：被测应用自己的 Langfuse self-host 配置（app 的【第一路】可观测）。
- `agents/web-agent.ts`：fasteval adapter，工厂函数 `webAgent({ baseUrl })`。`baseUrl`（被测 web agent 跑在哪）由调用方传入——`fasteval.config.ts` 注册默认实例、`experiments/` 可各传各的；adapter 自己不写死、不读 env。它把响应按同一 workspace 共享的 `AgentResponse` 契约读、映射成标准 `StreamEvent[]`。
- `evals/`：问天气（工具调用）、图片理解两个会话型 eval。
- `experiments/compare-models/`：一个实验组，每个文件钉一个 model（`gpt-4o-mini.ts` / `gpt-4o.ts`）跨模型对比。

## 双可观测（dual observability）

被测 app 自带 Langfuse（第一路）。adapter 声明 `capabilities.tracing` 后，fasteval 会为每次运行起一个本机 OTLP 接收器，把 endpoint 经 `ctx.telemetry` 交给 adapter；adapter 随每轮请求把它带给 web agent（请求体 `otelEndpoint`）。web agent 于是把这一轮的 turn / model / tool span 也按 OTLP/JSON 发回 fasteval（第二路）——`npx fasteval view` 里直接出瀑布图，和 Langfuse 互不影响。

mock 模式也会发（不需要 API key 就能看到 trace）；AI 模式额外带上 model span 和 token 用量。

这个目录是一个**独立的 npm 项目**（自带 `package.json`，把 `fasteval` 当普通发布版依赖），不属于本仓库的 monorepo。被测 web agent 的源码在 `ai-sdk-agent/`（无单独 package.json，就是本项目的源码）。

## 启动被测 agent

先装依赖、启动 web agent：

```sh
cd examples/zh/ai-sdk
pnpm install
pnpm dev          # = tsx watch ai-sdk-agent/server.ts
```

默认是 `AGENT_MODE=mock`，不需要 API key，适合先验证 fasteval 接线（工具与图片理解都有确定性 mock）。要跑真实 AI SDK：

```sh
AGENT_MODE=ai OPENAI_API_KEY=... pnpm dev
```

如果要看应用自己的 Langfuse trace：

```sh
cd examples/zh/ai-sdk/ai-sdk-agent/langfuse
cp .env.example .env
# 编辑 .env，把 replace-me 的 key/password 换成本机值
docker compose up -d
```

然后把 `LANGFUSE_BASE_URL`、`LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY` 填到 `examples/zh/ai-sdk/.env`。不要提交 `.env`；仓库里只保留 `.env.example` 和变量化的 compose。

可选变量：

- `PORT`：web agent 端口，默认 `5188`
- `OPENAI_BASE_URL`：OpenAI-compatible 网关
- `AGENT_MODEL`：web agent 默认模型，默认 `gpt-4o-mini`

## 跑 eval

另开一个终端（同在 `examples/zh/ai-sdk`，`fasteval` 已是本项目依赖）：

```sh
pnpm exec fasteval list           # 列出 2 个 eval
pnpm exec fasteval                # 全跑
pnpm exec fasteval weather-tool   # 只跑某个
pnpm exec fasteval exp compare-models  # 跨模型对比(需 OPENAI_API_KEY)
```

`baseUrl` 写在 `fasteval.config.ts` 里（默认 `http://127.0.0.1:5188`），adapter 不读 env。换个被测实例只改 config / experiment 里那一行。

跨模型对比写**多个实验文件**：`experiments/compare-models/` 下每个文件钉一个 `model`（`model` 是单个字符串，不接受数组）。

`fasteval.config.ts` 注册的是 remote agent，所以不会创建 Docker 沙箱；如果 eval 里使用 `t.diff`、`t.testsPassed()` 或 workspace 文件断言，需要改用 sandbox agent。

没有 judge API key 时，eval 只跑确定性断言和工具调用断言；设置 `OPENAI_API_KEY`、`CODEX_API_KEY` 或 `FASTEVAL_JUDGE_KEY` 后，会额外启用 soft judge 评分。
