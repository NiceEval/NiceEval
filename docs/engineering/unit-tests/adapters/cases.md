# Adapters 与协议归一的测试用例

本页是 Adapter 契约的场景登记表。fixture 规范见 [测试架构](README.md)；SDK 专项场景以对应 [SDK 契约页](../../../feature/adapters/sdk/README.md)为准。

## 标准事件归一

契约来源：[标准事件](../../../feature/adapters/architecture/events.md)。

| 契约 | 场景 |
|---|---|
| `action.called` 与 `action.result` 用稳定 callId 配对，并发调用的交错帧各自配对不串线 | 正例：单调用；正例：两调用交错帧；边界：合成 id 兜底时的单并发限制 |
| 事件保持原始发生顺序输出，不按类型重排 | 正例：message/thinking/工具帧交错时顺序与输入一致 |
| 人工/策略拒绝归一为 `status:"rejected"`，执行故障归一为 `status:"failed"`，不互相混淆 | 正例：denied 帧 → rejected；正例：非零退出 → failed；反例：拒绝不得产出 failed |
| Skill 加载只产生 `skill.loaded`，不重复计入 action 工具对；限定名（`namespace:skill`）原样作为 `skill` 字段透传，不拆分或改写 | 正例：Skill 帧 → 仅一条 skill.loaded；反例：无对应 action.called；边界：`ms-office-suite:pdf` 这类限定名整串原样透传 |
| Adapter 不截断工具输出；截断只发生在落盘写入面 | 边界：>256 KiB 输出在事件中完整 |
| `name` 保留协议原始工具名，`tool` 保存跨 Agent 规范名，两字段并存 | 正例：`command_execution` → name 原名 + `tool:"shell"`；边界：无规范名映射时 tool 省略 |
| 一个原生审批/提问只产生一条 `input.requested`，request 携带足以匹配的 id/action/input/options | 正例：审批帧 → 单条请求且字段齐全；反例：同一问题多帧不产生重复请求 |
| `deriveRunFacts` 对只有 called 或只有 result 的不完整配对容错折叠，不抛错 | 边界：孤儿 called；边界：孤儿 result |
| 被测系统内部机制注入进上下文、但不构成一条消息的文本归一为 `context.injected`（不套进 `message.role`）；只有携带实际文本的注入产生事件，纯执行确认信号不产生事件 | 正例：带文本的注入帧 → 一条 `context.injected` 且 `text` 完整；反例：只表示"执行完毕"不带文本的帧 → 不产生事件；`deriveRunFacts` 的 `contextInjections` 计数与事件条数一致 |

示例——读取真实 JSONL 并断言标准事件，断言选语义字段：

```ts
import { readFile } from "node:fs/promises"
import { expect, it } from "vitest"
import { fromCodexThreadEvents } from "../../agents/sdk-streams.ts"

it("command_execution 被归一成一对有相同 callId 的事件", async () => {
  const raw = await readFile(
    new URL("./fixtures/codex-cli/command-success.jsonl", import.meta.url),
    "utf8",
  )
  const frames: unknown[] = raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  const adapter = fromCodexThreadEvents()

  const events = frames.flatMap((frame) => adapter.add(frame))

  expect(events).toEqual([
    {
      type: "action.called",
      callId: "<call-1>",
      name: "command_execution",
      input: { command: "pnpm test" },
      tool: "shell",
    },
    {
      type: "action.result",
      callId: "<call-1>",
      output: { output: "53 passed", exit_code: 0 },
      status: "completed",
    },
  ])
  expect(adapter.usage).toEqual({
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 40,
    requests: 1,
  })
})
```

## 证据完整性与协议状态机

契约来源：[采集](../../../feature/adapters/architecture/collection.md)、[证据完整性](../../../feature/adapters/architecture/evidence.md)。单帧正确不代表状态机正确，拒绝、重复完成、截断和乱序按序喂入。

| 契约 | 场景 |
|---|---|
| 无结构化行为来源时返回空事件并显式声明负断言不可信，不从最终文本猜测工具事件 | 反例：仅有最终文本时 events 为空且带完整性限制 |
| 重复的 terminal 帧（同一 tool_use_id 的第二条 tool_result）不产生第二个结果事件 | 反例：rejected 后重复 tool_result 增量为空；边界：完全相同帧重放 |
| 流截断或进程失败时已解析事件保留、不伪造终止事件，Turn status 反映失败 | 边界：JSONL 半行截断；边界：只有 called 无 result；反例：不合成 action.result |
| 未知新类型 frame 被忽略，不破坏前后已知帧 | 边界：已知-未知-已知序列；边界：非 JSON 脏行夹在 JSONL 中 |
| transcript 与结构化 stdout 同时存在时只采集一份 | 反例：双来源可用时事件数不翻倍 |
| OTel span 永不补写行为事件；span 缺失或脱敏只使 trace 降级，`StreamEvent[]` 不变 | 反例：仅有 span 时 events 为空 |
| 协议缺少稳定 call id 时按位配对，并发限制体现为显式完整性边界 | 正例：顺序调用按位配对；边界：无关联字段时的既定降级 |
| 乱序帧（result 先于 called、只有 terminal 帧）有既定行为且不崩溃 | 边界：result-before-called；边界：只有 terminal 帧的流 |
| 官方 SDK 适配器显式声明全通道证据覆盖；协议本身缺失的通道如实标 `unavailable`，不留成 `unknown` | 正例：`uiMessageStreamAgent` 声明 events/actions/messages/status/data 为 `complete`、usage 为 `unavailable`（UI Message Stream 协议帧不带 token 计数） |

完整性 fixture 至少覆盖五种收尾形态：完整成功、协议明确结束但某类证据不提供、流被截断或进程失败、未知帧夹杂、重复或乱序。测试同时断言标准事件和完整性标记。

示例——协议状态序列：

```ts
it("permission denied 与随后重复的 tool_result 只形成一个 rejected 结果", () => {
  const adapter = fromClaudeSdkMessages()

  adapter.markRejected("tool-1")
  const denied = adapter.add({
    type: "system",
    subtype: "permission_denied",
    tool_use_id: "tool-1",
  })
  const duplicate = adapter.add({
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: "tool-1", content: "denied" }],
    },
  })

  expect(denied).toEqual([
    { type: "action.result", callId: "tool-1", status: "rejected" },
  ])
  expect(duplicate).toEqual([])
})
```

## Turn 状态与 usage

契约来源：[证据完整性](../../../feature/adapters/architecture/evidence.md)、[Session 状态](../../../feature/adapters/architecture/session-state.md)、[Agent 契约](../../../feature/adapters/architecture/agent-contract.md)、[标准事件](../../../feature/adapters/architecture/events.md)。

| 契约 | 场景 |
|---|---|
| Turn `completed` 只表示一轮正常结束；含 failed action 的正常结束轮仍为 completed | 正例：含一个 failed 工具的成功轮；反例：工具失败不翻转 status |
| `waiting` 当且仅当事件流中存在结构化 `input.requested` | 正例：审批暂停 → waiting + 请求事件；反例：无请求事件不得 waiting |
| `ctx.diagnostic` 记录永久 warning/error 但不改变 Turn status 或 verdict | 正例：send 中发 diagnostic 后 Turn 仍 completed |
| 原始协议未提供 usage 时省略字段，不编造零或估算值 | 反例：无 usage 帧时 `Turn.usage` 为 undefined 而非 `{inputTokens:0}` |
| 多帧/多 step 的 usage 按轮聚合（含 cache tokens、requests 计数） | 正例：两个 step 求和；边界：部分 step 缺 usage |

## Session 与 HITL 状态机

契约来源：[Session 状态](../../../feature/adapters/architecture/session-state.md)、[Sessions 与 HITL](../../../feature/adapters/library/sessions-and-hitl.md)。

| 契约 | 场景 |
|---|---|
| `capture()` first-writer-wins：resume 轮 capture 不同 id 不替换首轮捕获 | 正例：首轮捕获；反例：第二次 capture 不覆盖；边界：capture(undefined) 不写入 |
| 新 AgentSession 的 id 为 undefined、history 为空，`newSession()` 无需供应商分支 | 正例：新 session 首轮请求不带 sessionId；反例：两个 session 不共享状态 |
| `hold()` / `take()` 保存暂停现场且 take 一次消费 | 正例：hold 后 take 取回；边界：连续两次 take 第二次 undefined |
| respond 是同一 AgentSession 的下一轮 send，按 `input.responses` 的 requestId 匹配回答，不按数组位置猜测 | 正例：requestId 匹配恢复；反例：responses 乱序仍正确；边界：requestId 不匹配 |
| `history().get()/commit()`：commit 后下一轮 get 返回提交内容；不同时以 history 和 session id 维护两份真相 | 正例：两轮重放历史增长；反例：首轮 get 为空数组 |
| 会话状态只存于 `ctx.session`，并发 attempt 不串线 | 反例：两个并发 attempt 各自 capture 互不可见 |

## 流式组合件

契约来源：[Streaming](../../../feature/adapters/library/streaming.md)。

| 契约 | 场景 |
|---|---|
| `driveFrameStream` 顺序消费 cursor、累积事件与 usage；onFrame 返回 pause 时保存现场并返回 waiting Turn | 正例：完整流 → completed；正例：审批帧 → waiting + hold 现场 |
| `deltaStream` 按 call id/index 累积文本与参数字符串，到结束信号才 JSON.parse 落地 | 正例：分片参数拼接后解析；边界：两个 index 交错；反例：未收到结束信号不产出半个 JSON |
| `sseJsonFrames` 把 `data: {...}` 行解析为逐帧 JSON，跳过 `[DONE]` | 正例：多帧 SSE；边界：一帧跨多个 chunk |

## Coding Agent 扩展安装

契约来源：[Coding Agent 扩展](../../../feature/adapters/architecture/coding-agent-extensions.md)、[Bub](../../../feature/adapters/sdk/bub/README.md)。

| 契约 | 场景 |
|---|---|
| `marketplace.name` 必须等于目标仓库 manifest 的 name；add 后回读校验，不匹配立刻抛含两个名字的错误 | 正例：一致通过；反例：不一致 setup 即抛 |
| 路径不存在、仓库拉不到、Skill 选择歧义、Plugin 不存在、MCP 写入失败均在 setup 抛出使 attempt errored | 反例：本地路径缺失；反例：多 Skill 未显式选择时列出候选；边界：仓库唯一 Skill 免选 |
| 扩展安装每 attempt 只执行一次，多轮 send 不重复安装 | 正例：两次 send 后安装命令只跑一次 |
| 同名 Skill 多来源时按配置顺序安装，manifest 保留每个来源 | 边界：两来源同名的 manifest 条目数与顺序 |
| 安装 checkpoint key 覆盖所有影响环境的配置，配置变化触发重装 | 正例：改 pythonPlugins 版本 → key 变化；反例：无关配置不变 key |
| Claude Code `settingsFile` / Codex `configFile` 是本地项目内的完整官方配置文件，不是 Sandbox 路径；只接受项目根内相对路径，Adapter 本地读取后上传并原样替换隔离用户层，不继承宿主机配置、不做 deep merge 或重新序列化 | 正例：普通相对路径与 `./` 前缀；正例：注释与 schema 标记按原字节保留；反例：`..`、绝对路径、`~`、符号链接逃逸、Sandbox 路径；反例：JSON/TOML 语法错误 |
| 原生配置与 Adapter 所有权分层，保留键冲突 setup 失败；checkpoint 与 manifest 使用原始字节 SHA-256，manifest 不含正文 | 反例：文件含 model/MCP/OTel 保留键；正例：改一个字节 → key/hash 变化；反例：artifact 中出现配置正文或 secret |
| Bub factory 不接受 mcpServers 或 Claude/Codex 原生 plugins 字段 | 类型/运行时反例：传入不支持字段 |
| HTTP 形态 McpServer 落位：Claude Code 写 `~/.claude.json` 的 `type: "http"` + `url` + `headers`，Codex 写 `[mcp_servers.<name>]` 的 `url` 与 `[mcp_servers.<name>.http_headers]` 子表 | 正例：两个 adapter 各写对形状；边界：无 headers 时不写空 headers 字段/子表 |
| 同一 MCP server 同时给出 `command` 与 `url` 时 setup 报错点名该 server | 反例：双字段配置 setup 即抛 |
| manifest 的 MCP 条目只记非 secret 字段：stdio 记 name/command/args 不记 env，HTTP 记 name/url 不记 headers | 反例：manifest 序列化结果不含 env/headers 值 |
| `postSetup` 钩子在 Adapter 全部安装步骤与 manifest 之后按数组顺序执行，cleanup 按 LIFO 收尾，钩子抛错 setup 抛出（attempt errored） | 正例：命令顺序为 安装→manifest→钩子且多钩子按序；正例：cleanup LIFO；反例：钩子抛错传播 |
| `CodexPluginSpec.marketplace.sparse: string[]` 逐项生成 `--sparse <path>`（shell 引用），manifest 不记录该项 | 正例：两项路径 → 两个带路径的 flag；反例：缺省与空数组不含 |

## SDK 专项

每个 SDK 的场景矩阵来自它自己的契约页，wire fixture 从对应 E2E 仓库的真实运行沉淀。

| SDK | 契约要点 | 关键场景 |
|---|---|---|
| [Claude Agent SDK](../../../feature/adapters/sdk/claude-agent-sdk/README.md) | 按 tool_use_id 配对生命周期；assistant text/thinking 转换；result 帧提取 usage、cost、失败状态与 session_id；rejected 后重复 tool_result 不再产出 | 完整成功流；并发 tool_use 交错；result 帧 is_error；无 result 帧的截断流 |
| [Claude Code](../../../feature/adapters/sdk/claude-code/README.md) | transcript JSONL 配对消息/thinking/工具/usage/session；Skill Tool 归一为 skill.loaded；`hook_additional_context` 归一为 context.injected（source 取 hookName），配对的 `hook_success` 不产生事件 | 真实 transcript 全链；Skill 调用不计工具；OTel 脱敏时行为轨仍以 transcript 为准；`hook_additional_context` 行 → 一条 context.injected；`hook_success` 行 → 不产生事件 |
| [Codex SDK](../../../feature/adapters/sdk/codex-sdk/README.md) | 消息、reasoning、command execution、文件变更、MCP 工具与 usage 归一；不可观察的 HITL 不伪造 input.requested | command 成功/失败对；文件变更；中断 turn；反例：任意 fixture 不产生 input.requested |
| [Codex CLI](../../../feature/adapters/sdk/codex-cli/README.md) | 行为轨来自 `codex exec --json` stdout；session id 取自 thread started；实际模型从 session 侧写读取而非只信请求参数；exec 命令一律携带审批/沙箱与 hook trust 的 bypass flags | thread started → capture；显式 call id 并发配对；侧写模型与请求参数不一致时以侧写为准；首轮与 resume 命令都含 `--dangerously-bypass-hook-trust` |
| [AI SDK](../../../feature/adapters/sdk/ai-sdk/README.md) | step content、tool call id、tool result、approval part 与聚合 usage 构造 Turn，兼容多代字段名；SSE reducer 支持历史重放与 approval 改写重发 | 多 step 工具往返；approval part → input.requested + waiting；新旧字段名各一份 fixture；重放历史不产生重复事件 |
| [pi-agent-core](../../../feature/adapters/sdk/pi-agent-core/README.md) | 消息 start/delta/end 聚合为完整 message；工具执行、usage 与失败状态 | 三段式聚合成一条；只有 start/delta 的截断；失败状态帧 |
| [LangGraph](../../../feature/adapters/sdk/langgraph/README.md) | tools channel started/finished/error 按 call id 配对；interrupt → input.requested；lifecycle 映射 Turn 状态；namespace 映射 subagent 层级；按 seq 恢复顺序 | messages+tools 全链；interrupt → waiting；subgraph namespace → subagent 事件；seq 乱序帧 |
| [Remote Agent](../../../feature/adapters/library/remote-agent.md) | 应用不支持多模态时可忽略 `TurnInput.files`，但不得返回伪造的文件理解事件 | 边界：带 files 输入被忽略时无合成事件 |

## 不这样测

- 不手写一个已经长得像 `StreamEvent` 的"SDK payload"再断言原样输出。
- 不快照完整原始 transcript；它包含噪声、敏感信息和不稳定字段。
- 不断言 SDK 自己会构造 client 或解析 JSON。
- 不用一个 happy-path fixture 代表整个协议；场景矩阵来自 SDK Feature 契约。
