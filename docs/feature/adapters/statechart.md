# SSE 游标的状态

Adapter 通过 SSE 游标读取 Agent 的事件流：一次读取等一帧，遇到审批请求时本轮暂停、原 HTTP 响应保持，审批通过后在同一流上继续读；Attempt 关闭、显式关闭与取消随时可能到来。这一页用模型检查器核对 [Streaming](library/streaming.md) 的规则。

## 规则

### 一次只等一个读取 {#SingleInFlightRead}

一个游标同一时刻只等一个读取结果，并发的读取被拒绝。

### 关闭后不再交付帧 {#NoFrameAfterClose}

关闭清空缓冲；挂起中与之后的读取都不会再收到帧。

### 底层取消最多一次 {#CancelAtMostOnce}

底层取消最多发起一次；重复关闭拿到同一个回执，回执随底层结算。

### 等待答复时保持响应 {#WaitingKeepsTransport}

本轮暂停等待答复时保持原 HTTP 响应，审批通过后续读同一响应。

### Attempt 关闭后不交出游标 {#NoCursorAfterShutdown}

Attempt 关闭后迟到的响应被取消，游标不会交给 Adapter 作者。

### 已观察到的取消优先 {#ObservedAbortWins}

本轮交付前观察到取消时拒绝本轮，即使已经读到审批请求或流结束。

### 回执随底层结算 {#CloseReceiptSettlesWhenTransportSettles}

底层关闭结算后共用的回执最终结算；收尾超时只结束本方的等待。

## 模型

```statechart spec="./tla/sse/SseApproval.tla" config="./tla/sse/fixed.cfg" view="./tla/sse/view.ts" out="./tla/sse/out/fixed" digest="sha256:ad9e038dbd842d1b114330ba2ce267e097e7036693bf17f958de1278b7f4c28d"
```

一个 Attempt、同一响应上的两次 send、一个游标、一个挂起的读取、一个待解码的帧、一次观察到的取消与一次迟到的 body。七条规则都成立。图合并同一读者状态内的接收与读取，不画拒绝并发读取、结束等待、底层结算、收尾超时与终态。

## 按路径重放的测试

`test/integration/adapter-sse-close.test.ts` 重放两条路径：帧已经解码后显式关闭，挂起的读取曾仍收到这一帧；底层取消回调同步重入关闭时，曾拿到另一个回执。现在关闭后的交付先检查关闭，回执在发起取消之前就已安装。跨 send 的恢复、放弃、审批失败与竞争由 `e2e/adapter/local-protocol/test/frame-session.test.ts` 在真实 HTTP 上回放。

## 动作与代码

路径以 `packages/niceeval/src/` 为根。

| 动作 | 代码 |
| --- | --- |
| 发请求、收到 body、交出游标 | `agents/sse-frames.ts` |
| 读取、接收与解码帧、交付 | `agents/sse-frames.ts`；`agents/streaming.ts` 复查取消后归约 |
| 暂停、审批后续读 | `agents/streaming.ts`；`e2e/adapter/local-protocol/agents/frame-session.ts` |
| 观察取消、显式与重复关闭、回执结算 | `agents/sse-frames.ts`；`agents/streaming.ts` |
| Attempt 关闭、迟到 body | `runner/attempt.ts`；`runner/attempt-resources.ts`；`agents/sse-frames.ts` |

## 模型没有覆盖的部分

SSE 字节分段、Schema 错误、reducer 细节、应用层错误码、重复暂停、多个 Session 与同时登记的多个资源。
