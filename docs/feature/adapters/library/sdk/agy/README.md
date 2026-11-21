# Antigravity CLI（agy）

使用 `antigravityAgent` 在 Sandbox 中安装并运行 Google Antigravity CLI（命令名 `agy`），用它驱动的 Gemini 等模型作为被测 coding agent。

```ts
import { antigravityAgent } from "niceeval/adapter";

const agent = antigravityAgent({
  skills: [{ kind: "local", path: "skills/review/SKILL.md" }],
});
```

接入字段：`apiKey` 是 Gemini API key，省略时读 `GEMINI_API_KEY`；`baseUrl` 是可选的 Gemini 兼容端点，省略时读 `GOOGLE_GEMINI_BASE_URL`，两处都没有时不设置。
模型选择归 experiment 的 `model` 维度，原样透传 `--model`（例如 `gemini-4-argon-high`）；experiment 的推理档位透传 `--effort`，未声明时不传。

`version` 钉 Antigravity CLI 的发布版本；省略时用 NiceEval 钉的默认版本 `1.5.13`，不装 latest，也不跟随 CLI 自更新。被测对象版本必须能从实验配置读出来。

## 鉴权

只支持官方的 Gemini API 非交互鉴权：Adapter 在本 Attempt 隔离的用户配置目录写 `settings.json`，其中 `modelProvider` 为 `"gemini"`，再把 key 作为 `GEMINI_API_KEY` 只注入受管 `agy` 进程。key 不写进任何配置文件、命令行参数或 Record。

Google 账号 OAuth 不支持：官方只承诺登录态在同一台机器上复用，不保证搬到 Sandbox 后可用，搬运用户凭据还会扩大信任边界。Gemini Enterprise 的 ADC（`AGY_ADC_AUTH`）不在本契约内。

缺少 key 时 Adapter 在 `before` 阶段以配置错误失败，不启动 CLI。

## 驱动面

每次 send 启动一个有界的 print 进程，读完它的 NDJSON 后结束：

```sh
agy --print <text> --output-format stream-json --dangerously-skip-permissions \
  --disable-slash-commands [--conversation <id>] [--model <m>] [--effort <e>]
```

- 工作目录是被测 workdir；`HOME` 与 CLI 应用数据目录指向本 Attempt 的隔离状态目录，不继承宿主或镜像里的用户配置。
- 进程环境固定带 `AGY_CLI_DISABLE_AUTO_UPDATE=true`，保证运行期间被测版本不变。
- `--disable-slash-commands` 让用户输入按字面送给模型，以 `/` 开头的题面不会被当成命令展开。
- 首轮不带会话；`init` 或 `result` 事件里的 `conversation_id` 写入 `ctx.session.capture()`。续轮用 `--conversation <id>`；`t.newSession()` 后不传旧 id，开新会话线。不使用 `--continue`，它按"最近会话"选择，不能区分并发会话。
- 取消与超时由 `ctx.signal` 和 Sandbox 受管执行负责，Adapter 不另设 `--print-timeout`。

## 终态与失败

- 收到 `result` 且 `status` 为 `SUCCESS` 时，本轮 `completed`，回复文本按顺序拼接本轮 `agent_response` 的 `text_delta`；本轮没有 delta 时才用 `result.response`。
- 进程非零退出、被信号终止、NDJSON 无法解析、缺少 `result`，或 `result.status` 不是 `SUCCESS`，都按 `SendFailure` 报告，并保留已观测的事件、用量与退出信息。
- exit 0 不代表每个工具都执行成功：headless 模式会对无法批准的动作软拒绝并仍然退出 0。工具失败只从对应工具步骤的 `error` 读取。

## 行为轨与会话

parser 读取固定 CLI 版本的 `step_update` 事件：

- `agent_response` 的 `text_delta` 投影为助手消息。
- `step_type` 为 `tool` 的步骤以 `conversation_id` 加 `step_index` 配对 `ACTIVE` 与 `DONE`，得到一次工具 operation；原生工具名保留，已知工具按 [事件契约](../../../architecture/events.md) 归一。CLI 没有独立的工具调用 ID，Adapter 不从其它字段猜测。
- 工具步骤的 `output` 在部分工具上只是摘要（例如 `read_file` 只给行数与字节数），所以工具结果材料标为 partial。
- `user_input` 步骤只作为受理证据，输入正文以 NiceEval 自己记录的 `TurnInput` 为准。

未知步骤类型与事件不进入 `Turn.events`；每条 Attempt 在收尾时追加一条 `agent-event-unrecognized` warning，汇总类型与次数。出现未知事件时该轮事件和动作证据标为 partial，不作为完整负断言依据。

原生 `ask_question` 在 print 模式下没有可回答的请求事件，只表现为未知步骤，模型随后结束本轮。本 Adapter 不产生 `waiting` 状态：这种轮次按普通完成处理，下一条用户消息是新的一轮，而不是对原生问题的回答。需要原生 HITL 的题目不应选用本 Adapter；改走 ACP 入口属于后续工作，以实测证明实时请求、同轮回复与取消为前提。

Skills 落到 workdir 的 `.agents/skills/<name>/`。MCP 服务写进 workdir 的 `.agents/mcp_config.json`：本地 stdio 用 `command`、`args`、`env`、`cwd`；远程只支持 Streamable HTTP（`serverUrl` 与 `headers`），不支持旧的 HTTP+SSE。原生插件不支持。

## Prebuilt environment

Adapter 的必填 install 用 PATH 上 `agy --version`（带禁用自更新的环境变量）的精确版本作探测；命中即快速返回，未命中时由 identity 匹配的 Installer 安装锁定版本并复检。
Installer 只支持 Linux x86_64 glibc（glibc ≥ 2.28）：宿主按版本下载 GitHub 发布资产 `agy_cli_linux_x64.tar.gz`，用 NiceEval 钉在版本表里的 SHA-256 校验后作为 staged 载荷送入 Sandbox，解出归档里唯一的 `antigravity` 并安装为 `agy`。不使用官方 `install.sh`，它总是取最新清单。
`before` 不安装 CLI，只写本 Attempt 的鉴权配置、运行时设置与扩展。

用量口径见 [cost.md](cost.md)。
