# 流式协议与共享工具

流式 Adapter 应把读帧、增量归约和控制流分开。
niceeval 提供协议中立的组合件，避免每个 Adapter 重写 buffer、Map 和暂停循环。

## SSE JSON frames

`sseJsonFrames(body)` 把 SSE `data: {...}` 解码成 `JsonValue`，并跳过 `[DONE]`。
`sseJsonFrames(body, schema)` 从 Schema 推导帧类型，不接受无运行时证据的泛型断言。
它只解决 framing 与信任边界，不理解 SDK 事件语义。

```ts
interface SseFrameCursor<T> {
  next(): Promise<IteratorResult<T, void>>;
  return(): Promise<IteratorResult<T, void>>;
}

const cursor = sseJsonFrames(body, FrameSchema);
const frame = await cursor.next();
if (!frame.done) consume(frame.value);
```

`done` 区分数据与结束；JSON `null` 和 Schema 解码得到的 `undefined` 都是数据。
Schema 类型约束为 `Schema.ConstraintDecoder<unknown, never>`，不接收需要服务的 decoder。
同步解码是调用前提，类型不能证明任意无服务 Schema 都同步。
非法 JSON 或结构不匹配抛出 `SseFrameDecodeError`；异步 decoder 或 decoder defect 抛出 `SseFrameDecoderError`。
两者使用不超过 120 字符的固定英语文案，不附加输入、原异常 cause 或 Schema 错误树。

cursor 独占 reader，顺序读取，不预读；并发 `next()` 明确拒绝。
自然 EOF 释放锁；读取失败、解码失败和显式关闭取消 reader 并释放锁。
`return()` 先建立终态并清空 buffer，再直接取消 reader，不等待挂起的 `next()`。
关闭后的 pending next 与后续 next 都返回 done，不再交付缓冲帧。
重复 `return()` 返回同一个 Promise，底层取消只发起一次。
锁释放不等待取消回执；回执成功才表示取消完成，拒绝表示关闭失败。

### 跨 send 的 SSE 请求

需要在 HITL waiting 后续读的 HTTP 请求由 Attempt 持有：

```ts
declare function openSseJsonFrames(
  ctx: AgentContext,
  open: (signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>,
): Promise<SseFrameCursor<JsonValue>>;
declare function openSseJsonFrames<S extends Schema.ConstraintDecoder<unknown, never>>(
  ctx: AgentContext,
  open: (signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>,
  schema: S,
): Promise<SseFrameCursor<S["Type"]>>;
```

Adapter 的 open 负责 endpoint、headers 和 HTTP 状态校验，必须把收到的 signal 传给 transport。
`openSseJsonFrames` 要求 Runner 绑定的 Attempt resource registry；手工上下文缺少 owner 时在发请求前拒绝。
手工管理生命周期的调用方使用 `sseJsonFrames` 并自行关闭 cursor。

请求入口先登记纯 holder，再发请求，holder 持有独立 AbortController 和关闭回执。
获取响应期间监听本轮 ctx.signal，finally 移除监听；响应后由 driver 监听当前回调取消。
请求只绑定 holder 的稳定 signal，首轮 send 正常返回 waiting 不会取消响应。
open 失败立即关闭 holder，保留 open 主错误；关闭后迟到的 body 立即取消，不能交付 cursor。

Attempt registry 的 shutdown/release 回调先同步关闭 transport，再按 cleanup signal 有界等待回执。
即使 signal 已取消也先发起关闭，使串行 registry 继续关闭较早资源。
超时不能声明底层回执已完成，迟到的 rejection 仍须被观察。
正常终态清空 reader/buffer 引用，registry 只保留幂等关闭回执。

typed slot 只保存暂停现场，take 不转移最终清理责任。
从 take 到审批再到 drive 之间失败时，Adapter 立即关闭 cursor 并保留审批主错误。
暂停后不再回答的资源由最终 Attempt cleanup 关闭；newSession 不触发全局析构，旧 session handle 仍可恢复。

## SDK reducer

完整单元事件优先交给 [`sdk/`](sdk/README.md) 对应转换器，例如：

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
保存现场是 `onFrame` 自己的责任——adapter 定义 typed key，在返回 pause 前用 `ctx.session.set(key, ...)` 存住 cursor 与 reducer。
回答轮 `ctx.session.take(key)` 取回接着读同一条流。
`driveFrameStream` 只负责停轮，不代为保存。

driver 在读取前订阅本轮 ctx.signal，取消主动关闭 cursor。
每次 await 后和交付 waiting/completed 前检查取消，已观察到的取消优先于 EOF 或 pause，必须 reject。
waiting 交付后移除本轮订阅，transport 保持由 Attempt 持有。
正常结束、失败和取消都关闭 cursor；读取、reducer 或 hook 的主异常优先于清理失败。
已有主异常时，关闭失败用固定 `stream-cleanup-failed` diagnostic 报告，不附加原始错误树；无主异常时向调用方报告。
外部取消回执等待沿用所属 Attempt 的 deadline，不承诺任意外部实现都会完成。

```ts
const heldKey = createSessionKey<Held>("my-agent/held-stream");

return driveFrameStream(cursor, reducer, ctx, (frame) => {
  if (!isApproval(frame)) return;
  ctx.session.set(heldKey, { cursor, reducer, requestId: frame.id });
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
