---
name: langgraph-stream-status-stale-across-resume
description: "fromLangGraphEvents() 的 LangGraphStream.status 是持久 getter,resume 后如果新帧不触碰 lifecycle,读到的仍是暂停前的 \"waiting\"——HITL adapter 判断「这一帧是不是新产生了 input.requested」不能拿 stream.status 当依据,要看 stream.add(frame) 这一次自己返回了什么"
metadata:
  type: infra-bug
---

**现象**：`e2e/repos/langgraph` 的 `agents/langgraph.ts`(用官方 `fromLangGraphEvents()` 转换器,
`ctx.session.hold`/`take` 跨暂停复用**同一个** `LangGraphStream` 实例以保持 seq/命名空间/去重
状态连续)在 resume 轮(`t.respond("accept")` 之后)总是立刻抛:

```
input.requested 事件缺少 request.id——LangGraph interrupt 必须带 id 才能定位恢复请求
```

`show --execution` 看真实事件流:第一轮 `input.requested` 本身完全正常(带着 id),问题只在
第二轮(resume 后)6ms 内就炸,说明根本没读到第二轮的新帧就误判了。

**根因**：最初的 `drainStream` 循环写的是 `if (stream.status === "waiting") { … }` 来判断
"这一帧触发了 interrupt,要停轮"。但 `stream.status` 是 `fromLangGraphEvents()` 返回对象上的
一个**持久 getter**,只在 `handleLifecycle` 处理 `completed`/`failed`/`interrupted` 时才更新,
其它帧(比如 resume 后第一个到达的 `tools/finished` 帧)完全不碰它。resume 复用的是**同一个**
`stream` 实例(为了保 seq/去重状态连续),所以 resume 后处理的第一个帧,`stream.status` 读到的
还是**上一轮暂停时**写进去的 `"waiting"`——代码错误地以为"又停轮了",于是在这一轮全新的
`events` 局部数组里找 `input.requested`,自然找不到(它是上一轮的事实,这一轮数组是空的重新
开始)。

**修法**：判断"这一帧是否触发了新的 input.requested",只看 `stream.add(frame)`
**这一次调用自己返回的事件数组**里有没有 `input.requested`,不要读 `stream.status` 这个跨调用
持久化的 getter。`stream.status` 只适合在**整段 drain 彻底结束时**(cursor 耗尽、连接关闭)读一次
作为这个 Turn 的最终状态(此时它一定被最后一个 lifecycle 帧刷新过)。适用场景:任何用
`fromLangGraphEvents()` 且需要跨暂停复用同一个 `LangGraphStream` 实例实现 HITL resume 的
adapter——`status` getter 的"持久化、不自动清零"语义在多轮场景下容易被想当然地当成"这一帧
的状态"来读。修在 `e2e/repos/langgraph/agents/langgraph.ts` 的 `drainStream`。
