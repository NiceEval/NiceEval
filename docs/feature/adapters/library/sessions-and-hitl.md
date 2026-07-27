# 使用会话与 HITL

Adapter 通过 `ctx.session` 接入多轮会话和暂停恢复。根据被测服务的会话方式选择一种存取器。

## 服务端保存历史

请求携带上轮取得的 session/thread ID，首轮不带：

```ts
async send(input, ctx) {
  const response = await fetch("https://agent.example/chat", {
    method: "POST",
    body: JSON.stringify({ text: input.text, sessionId: ctx.session.id }),
    signal: ctx.signal,
  });
  const body = await response.json();
  ctx.session.capture(body.sessionId);
  return toTurn(body);
}
```

不要自己判断是不是新会话：新 session 的 `ctx.session.id` 自然是 undefined。

## 客户端重放历史

无状态服务要求每轮发送完整消息数组时：

```ts
const historySlot = createSessionSlot<ModelMessage[]>("my-agent/history");

async send(input, ctx) {
  const messages = [
    ...(ctx.session.get(historySlot) ?? []),
    { role: "user", content: input.text },
  ];
  const result = await generate(messages, { signal: ctx.signal });
  ctx.session.set(historySlot, [...messages, result.message]);
  return toTurn(result);
}
```

同一个 Adapter 不要同时用 history 和 session ID 保存两份历史。

## 返回待输入请求

Agent 停在审批或提问时，返回 waiting 和结构化请求：

```ts
return {
  status: "waiting",
  events: [{
    type: "input.requested",
    request: {
      id: approval.id,
      action: approval.tool,
      input: approval.input,
      options: [{ id: "approve" }, { id: "deny" }],
    },
  }],
};
```

eval 随后可以取得请求并回答：

```ts
const request = t.requireInputRequest({ action: "deploy" });
await t.respond({ request, optionId: "approve" });
```

## 恢复暂停的流

原生 SDK 在请求处暂停、同一条流要继续消费时，把 cursor、reducer 和 request ID 保存在 session：

```ts
const heldSlot = createSessionSlot<Held>("my-agent/held-stream");

async function send(input: TurnInput, ctx: AgentContext) {
  const held = ctx.session.take(heldSlot);

  if (held) {
    const response = input.responses?.find(
      (item) => item.requestId === held.requestId,
    );
    await resumeNativeRequest(held.requestId, response);
    return driveFrameStream(held.cursor, held.reducer, ctx);
  }

  // 开始新一轮；遇到审批 frame 时调用 ctx.session.set(heldSlot, ...)
}
```

始终按 `requestId` 找结构化回答，不按数组位置或 `input.text` 猜测。拒绝执行的工具结果使用 `status: "rejected"`。

内部状态和握手不变量见 [Architecture · 会话与 HITL 状态模型](../architecture/session-state.md)。
