# 会话与 HITL 状态模型

每条 eval session 持有独立 `AgentSession`，生命周期与 attempt 绑定。

```ts
interface SessionSlot<T> {
  readonly key: symbol;
}

function createSessionSlot<T>(name: string): SessionSlot<T>;

interface AgentSession {
  readonly id?: string;
  capture(id: string | undefined): void;
  get<T>(slot: SessionSlot<T>): T | undefined;
  set<T>(slot: SessionSlot<T>, value: T): void;
  take<T>(slot: SessionSlot<T>): T | undefined;
}
```

## 状态不变量

- 服务端历史模式使用 `id` / `capture()`；客户端历史模式由 adapter 定义一个 typed slot 保存消息数组，不维护两份会话真相。
- `capture()` first-writer-wins，resume 轮不能替换原 ID。
- 新 session 的 ID 为 undefined、所有 slot 为空，因此 `newSession()` 不需要供应商分支。
- HITL adapter 用自己的 typed slot 保存未消费流的暂停现场；`take(slot)` 一次消费。
- slot 的 symbol 身份隔离不同 adapter / 能力的状态；core 不解释 slot 内值，也不开放易碰撞的字符串字典。
- 会话状态不得放在模块级 Map，避免并发 attempt 和新 session 串线。

## HITL 握手不变量

```text
send(prompt)
  ← Turn { status: waiting, events: [..., input.requested] }
requireInputRequest(filter)
respond({ request, optionId | text })
  → 同一 AgentSession 恢复
  ← Turn { status: completed | waiting, events: [...] }
```

waiting、请求事件、结构化 request ID 和同一会话恢复缺一不可。`respond` 是同一 session 的下一轮 send，不是运行器绕过 Adapter 调用供应商 API。
