# OpenCode

使用 `openCodeAgent` 在 Sandbox 中安装并运行 OpenCode CLI。

```ts
import { openCodeAgent } from "niceeval/adapter";

const agent = openCodeAgent({
  skills: [{ kind: "local", path: "skills/review/SKILL.md" }],
});
```

接入字段：`apiKey` 是模型 API key，省略时读 `OPENCODE_API_KEY`，再回落 `ANTHROPIC_API_KEY`；`baseUrl` 是可选的 OpenAI 兼容端点，省略时读 `OPENCODE_BASE_URL`。
写了 `baseUrl` 时，Adapter 在 `opencode.json` 里注册 `compat` provider（`@ai-sdk/openai-compatible`）。
模型选择归 experiment 的 `model` 维度：已含 `/` 的原样透传 `--model`；不带 provider 前缀的模型名在自定义网关下写成 `compat/<model>`。

`version` 钉 npm 包 `opencode-ai` 的版本；省略时用 NiceEval 钉的默认版本，不装 latest——被测对象版本必须能从实验配置读出来。

## 驱动面

非交互执行用 `opencode run <prompt> --format json --auto`：

- `--format json` 把行为轨打成 stdout 上的 JSON 事件行；
- `--auto` 自动批准未显式拒绝的权限，适配 headless 沙箱；
- 首轮不带 session；事件里的 `sessionID` 写入 `ctx.session.capture()`；
- 续轮用 `--session <id>`；`t.newSession()` 后不传旧 id，开新会话线。

鉴权与 provider 写进项目级 `opencode.json`（沙箱内），不继承宿主机配置。
 secret 走环境变量，不写进配置文件。

## 行为轨与会话

行为轨优先来自 `run --format json` 的结构化 stdout。
工具事件带稳定 call ID 时按 ID 配对；缺显式 ID 时只能按位配对，此时不声明并发工具负断言。

stdout 拿不到完整工具轨迹时，Adapter 用 `opencode export <sessionID>` 补读会话侧写；两者都缺则返回空事件并声明负断言不可信，不从最终文本猜测调用过程。

Skills 落到 `.agents/skills/<name>/`，并写发现指引进 `AGENTS.md`。
 OpenCode 不接受 Claude/Codex 的 `mcpServers` 或原生 `plugins` 字段。

## 预制环境

Adapter 的必填 ensure 用 PATH 上 `opencode` 的精确版本作 探测；预装命中即快速返回，未命中时由 identity 匹配的 Installer 安装锁定版本并复检。
 NiceEval 公共镜像 `niceeval/opencode`（`NICEEVAL_OPENCODE_DOCKER_IMAGE`）把 CLI 烘焙进 `/usr/local/bin`。
`setup` 不安装 CLI，只写本 Attempt 的鉴权、运行时配置与扩展。预装只是快速路径，不是正确性前提。
