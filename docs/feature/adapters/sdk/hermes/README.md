# Hermes Agent

使用 `hermesAgent` 在 Sandbox 中安装并运行 Hermes Agent CLI。

```ts
import { hermesAgent } from "niceeval/adapter";

const agent = hermesAgent({
  skills: [{ kind: "local", path: "skills/review/SKILL.md" }],
});
```

接入字段：`apiKey` 是模型 API key，省略时读 `HERMES_API_KEY`，
再回落 `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY`；
`baseUrl` 是可选的 OpenAI 兼容端点，省略时读 `HERMES_API_BASE`。
写了 `baseUrl` 时，Adapter 在沙箱内 `~/.hermes/config.yaml` 注册
`provider: custom` 与带 `api_key` 的 `custom_providers` 条目，另写一份
`~/.hermes/.env`，并把 `--provider custom` 透传给 CLI。
模型选择归 experiment 的 `model` 维度。

`version` 钉 PyPI 包 `hermes-agent` 的版本；省略时用 NiceEval 钉的默认版本，
不装 latest。

## 驱动面

非交互执行用 `hermes chat -q <prompt> --yolo`：

- `-q` 单次查询，不进 TUI；
- `--yolo` 绕过危险命令审批，适配 headless 沙箱；
- 首轮由 Hermes 分配 session id；Adapter 从导出侧写或 CLI 输出捕获后
  `ctx.session.capture()`；
- 续轮用 `--resume <session_id>`；`t.newSession()` 后不传旧 id。

鉴权只写进沙箱内 `~/.hermes`，不继承宿主机配置。Hermes 是
[官方原生配置文件](../../library/coding-agent-extensions.md#使用官方原生配置文件)
那条「secret 走环境变量、不落盘」的例外：key 同时进 `~/.hermes/config.yaml` 的
`custom_providers[].api_key` 和 `~/.hermes/.env`。Hermes 只对可识别 host
（`openai.com`、`openrouter.ai` 一类）认进程环境里的同名 key，
OpenAI 兼容网关的凭据只能从这两个文件取；每次调用注入的环境变量是补充，不是来源。
两个文件由 Adapter 生成、随沙箱销毁，不进 manifest。

## 行为轨与会话

Hermes 的会话权威存储是 SQLite：`~/.hermes/state.db`
（messages 含 `tool_calls` / `tool_call_id` / `tool_name`）。
行为轨按以下优先级采集：

1. `hermes sessions export --session-id <id>` 的 JSONL（完整消息与工具轨迹）；
2. 直接读 `state.db` 同 session 的 messages 行（export 不可用时）；
3. 都拿不到则返回空事件并声明负断言不可信。

工具调用优先按 `tool_call_id` / call 对象里的显式 id 配对。
缺显式 ID 时只能按位配对，此时不声明并发工具负断言。

Skills 落到 Hermes 可发现目录（默认 `~/.hermes/skills/<name>/`），
并在需要时写发现指引。Hermes 不接受 Claude/Codex 的 `mcpServers`
或原生 `plugins` 字段。

## 预制环境

setup 检测 `$HOME/.local/bin/hermes`：预装命中即跳过安装，
缺失时用 `uv tool install hermes-agent==<version>` 回退安装（路径与 Bub 相同，
不依赖沙箱注入的 PATH）。NiceEval 公共镜像 `niceeval/hermes`
（`NICEEVAL_HERMES_DOCKER_IMAGE`）按同一布局烘焙。预装只是快速路径，不是正确性前提。
