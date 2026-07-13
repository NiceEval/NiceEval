# Adapters 与协议归一的单元测试

契约来源：[Adapters](../../feature/adapters/README.md)、[标准事件](../../feature/adapters/architecture/events.md)、[证据完整性](../../feature/adapters/architecture/evidence.md) 以及各 [SDK 契约](../../feature/adapters/sdk/README.md)。这类测试的核心不是 mock SDK 方法，而是证明真实协议形状被正确解释。

## 两种 fixture 不混用

### 协议证据 fixture

来自真实 SDK、CLI、SSE、JSONL 或 OTLP 输出，用于证明边界归一。建议与对应测试相邻：

```text
src/agents/fixtures/codex-cli/
├── README.md
├── command-success.jsonl
├── command-failed.jsonl
└── interrupted-turn.jsonl
```

`README.md` 为每个文件记录：

| Fixture | 来源版本 | 场景 | 脱敏 |
|---|---|---|---|
| `command-success.jsonl` | Codex CLI 1.2.3 | 一次 shell 调用成功并返回 usage | path、prompt、thread id |

原始文件保持 wire format；不要为了方便测试把 JSONL 重写成 niceeval 的 `StreamEvent[]`，否则 parser 最重要的工作已经被 fixture 作者做完。

### 领域场景 builder

手工构造标准 `StreamEvent[]`，用于测试 Scoring、derive 或 Reports。它不能证明 Adapter 正确：

```ts
function toolCallEvents(callId = "c1") {
  return [
    { type: "action.called", callId, name: "shell", input: { command: "pnpm test" } },
    { type: "action.result", callId, status: "completed", output: "ok" },
  ] satisfies StreamEvent[]
}
```

## 示例：读取真实 JSONL 并断言标准事件

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

断言选择语义字段；时间戳、SDK debug 字段和随机 id 除非参与契约，不进入期望值。采集时把 id 稳定脱敏为 `<call-1>`，同时保持引用关系。

## 示例：协议状态序列

单帧正确不代表状态机正确。拒绝、重复完成和只有 completed 帧等场景按序喂入：

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

## 完整性测试

Adapter 不应把“未采集到”写成“确认没有”。Fixture 至少覆盖：

- 完整成功结束，有 message、action pair、usage 和 session id。
- 协议明确结束但某类证据不提供。
- 流被截断或进程失败。
- 未知新 frame 被忽略，但不会破坏前后已知帧。
- 重复、乱序或只有 terminal frame 时的既定行为。

测试同时断言标准事件和完整性标记，不能只断言 parser 没抛错。

## 不这样测

- 不手写一个已经长得像 `StreamEvent` 的“SDK payload”再断言原样输出。
- 不快照完整原始 transcript；它包含噪声、敏感信息和不稳定字段。
- 不断言 SDK 自己会构造 client 或解析 JSON。
- 不用一个 happy-path fixture 代表整个协议；场景矩阵来自 SDK Feature 契约。
