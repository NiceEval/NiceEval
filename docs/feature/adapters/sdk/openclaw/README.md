# OpenClaw

使用 `openClawAgent` 在 Sandbox 中安装并运行 OpenClaw。

```ts
import { openClawAgent } from "niceeval/adapter";

const agent = openClawAgent({
  skills: [{ kind: "local", path: "skills/review/SKILL.md" }],
});
```

接入字段：`apiKey` 是模型 API key，省略时读 `OPENCLAW_API_KEY`，再回落 `ANTHROPIC_API_KEY`；`baseUrl` 是可选的 OpenAI 兼容端点，省略时读 `OPENCLAW_BASE_URL`。
写了 `baseUrl` 时，Adapter 在 `~/.openclaw/openclaw.json` 里注册 `compat` provider（`api: "openai-completions"`）。
模型选择归 experiment 的 `model` 维度：已含 `/` 的原样透传 `--model`；不带 provider 前缀的模型名在自定义网关下写成 `compat/<model>`。

`version` 钉 npm 包 `openclaw` 的版本，省略时用 NiceEval 钉的默认版本，不装 latest——被测对象版本必须能从实验配置读出来。

该工厂复用 `defineSandboxAgent`、共享安装工具、session 存取器与 canonical OTel mapper，不把 OpenClaw 方言加入 core。

## 驱动面

非交互执行用 `openclaw agent --local --json`：

- `--local` 走嵌入式 agent 循环，不依赖长驻 gateway；
- `--json` 产出结果封包（最终回复、session key、失败与 usage 摘要）；
- 首轮显式发全新 `--session-id`，并 `ctx.session.capture()`——不依赖默认主会话，避免相邻 attempt 静默共享历史；
- 续轮用同一 session id；`t.newSession()` 后发新 id。

## 行为轨与会话

行为轨优先来自 session transcript（`~/.openclaw/agents/**/sessions/*.jsonl`，pi-agent 系消息格式）。
工具调用按 `toolCall` / `toolResult` 的 call ID 配对。
采集优先读 `--json` 封包里的 `meta.agentMeta.sessionFile`；否则取该目录 mtime 最新的 session `*.jsonl`，并排除同目录 `*.trajectory.jsonl`（旁路轨迹，不是消息轨）。

transcript 拿不到时，只保留 `--json` 封包的最终回复，并声明负断言不可信——不从最终文本猜测工具行为。

Skills 落到 `.agents/skills/<name>/`，并写发现指引进 `AGENTS.md`。
OpenClaw 不接受 Claude/Codex 的 `mcpServers` 或原生 `plugins` 字段。

公开能力以真实 fixture / e2e 仓库固定的事实为准；未证明完整的行为不进公开能力声明。

## 预制环境

Adapter 的必填 ensure 用 PATH 上 `openclaw` 的精确版本作 探测；预装命中即快速返回，未命中时由 identity 匹配的 Installer 安装锁定版本并复检。
NiceEval 公共镜像 `niceeval/openclaw`（`NICEEVAL_OPENCLAW_DOCKER_IMAGE`）把 CLI 烘焙进 `/usr/local/bin`。
`setup` 不安装 CLI，只写本 Attempt 的鉴权与运行时配置。预装只是快速路径，不是正确性前提。
