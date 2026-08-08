# 流式协议与共享工具

流式 Adapter 应把读帧、增量归约和控制流分开。
niceeval 提供协议中立的组合件，避免每个 Adapter 重写 buffer、Map 和暂停循环。

## SSE JSON frames

`sseJsonFrames<T>(body)` 把标准 SSE `data: {...}` 转成可逐帧读取的 `SseFrameCursor<T>`，并跳过 `[DONE]`。
它只解决 framing，不理解 SDK 事件语义。

```ts
const cursor = sseJsonFrames<MyFrame>(response.body!);
const frame = await cursor.next();
```

## SDK reducer

完整单元事件优先交给 [`sdk/`](../sdk/README.md) 对应转换器，例如：

- `createClaudeSdkEventStream()`
- `createCodexThreadEventStream()`
- `createPiAgentEventStream()`

这些 reducer 持有一轮内的配对与 usage 聚合状态，但不持有 endpoint、鉴权或 Agent session。

## `deltaStream`

协议逐 token 或逐参数发送 delta、且没有官方 reducer 时，使用 `deltaStream(spec)`。
Spec 只声明一帧对应开始、增量、完成还是失败；通用实现按 call ID/index 管理 buffer。

不要在每个 Adapter 中重写“参数字符串累加到何时 JSON.parse”“哪个 index 对应哪个工具”等状态机。
如果协议没有稳定 ID，必须把并发限制写进完整性边界。

## `driveFrameStream`

`driveFrameStream(cursor, reducer, ctx, onFrame?)` 负责：

- 顺序读取 cursor；
- 把 frame 交给 reducer；
- 累积事件和 usage；
- 把应用私有的传输帧交给 `onFrame`；
- `onFrame` 返回 pause 信号时补一条 `input.requested` 事件并返回 waiting Turn，且不关闭 cursor。

`onFrame` 只识别 transport 特有行为，例如审批帧或服务器错误；SDK 标准事件仍由 reducer 处理。
保存现场是 `onFrame` 自己的责任——adapter 定义 typed slot，在返回 pause 前用 `ctx.session.set(slot, ...)` 存住 cursor 与 reducer。
回答轮 `ctx.session.take(slot)` 取回接着读同一条流。
`driveFrameStream` 只负责停轮，不代为保存。

```ts
const heldSlot = createSessionSlot<Held>("my-agent/held-stream");

return driveFrameStream(cursor, reducer, ctx, (frame) => {
  if (!isApproval(frame)) return;
  ctx.session.set(heldSlot, { cursor, reducer, requestId: frame.id });
  return {
    pause: {
      id: frame.id,
      action: frame.action,
      options: [{ id: "approve" }, { id: "deny" }],
    },
  };
});
```

## `shared` 工具袋

Sandbox Adapter 可以复用 `shared` 中的安装、采集、诊断和 JSONL 工具，例如：

- `ensureInstalled`
- `captureLatestJsonl`
- `extractJsonlFromStdout`
- `firstJsonField`
- session ID 处理工具
- `shellQuote`
- `diagnoseFailure`
- Agent transcript parsers

共享工具处理机械工作，不定义新的 Agent 注册表或通用供应商协议。
特定 SDK 的字段知识应放进独立转换器，特定 CLI 的 transcript 方言应放进独立 parser。

## 原始边界

采集层输出 raw string 或强类型 SDK frame；转换层输出标准事件。
保持这个边界可以让 parser/reducer 使用纯 fixture 测试，不依赖真实网络和 Sandbox。
