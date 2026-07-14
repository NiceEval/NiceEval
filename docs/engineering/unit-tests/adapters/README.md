# Adapters 与协议归一的测试架构

契约来源：[Adapters](../../../feature/adapters/README.md)、[标准事件](../../../feature/adapters/architecture/events.md)、[采集](../../../feature/adapters/architecture/collection.md)、[证据完整性](../../../feature/adapters/architecture/evidence.md)、[Session 状态](../../../feature/adapters/architecture/session-state.md) 以及各 [SDK 契约](../../../feature/adapters/sdk/README.md)。这类测试的核心不是 mock SDK 方法，而是证明真实协议形状被正确解释。用例登记在 [cases.md](cases.md)。

## 两种 fixture 不混用

### 协议证据 fixture

来自真实 SDK、CLI、SSE、JSONL 或 OTLP 输出，用于证明边界归一。与对应测试相邻：

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

原始文件保持 wire format；不要为了方便测试把 JSONL 重写成 niceeval 的 `StreamEvent[]`，否则 parser 最重要的工作已经被 fixture 作者做完。采集时把随机 id 稳定脱敏为 `<call-1>` 这类占位，同时保持引用关系。

真实协议 fixture 的采集来源是 E2E 测试仓库的真实运行产物：E2E 跑真实模型时留下的 wire 输出脱敏后沉淀成单元层 fixture，两层共享同一份协议事实，不各自手写。

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

## 观察面

Adapter 测试同时断言三个面，缺一个都可能放过静默伪证：

1. **标准事件序列**：语义字段逐项断言；时间戳、SDK debug 字段和随机 id 除非参与契约，不进期望值。
2. **完整性标记**：这份证据是"确认没有"还是"没采到"，负断言可信度由它决定。
3. **会话与用量**：session id 捕获、usage 聚合或如实省略。

只断言 parser 没抛错不构成测试。
