# 派生事实对"已发起还没结果"的工具调用乐观默认 completed

## 现象

给 HITL eval 写"批准前工具没执行"的反证时,`draft.notCalledTool(calc, { status: "completed" })`
在 waiting 轮上必红:这一轮只有 `action.called`(工具刚发起、正等审批),没有任何
`action.result`,断言却报"存在 completed 的 calculate 调用"。e2e langgraph 项目的
hitl-approve 首跑复现。

## 根因

`src/o11y/derive.ts` 里 `action.called` 建 ToolCall 时状态**乐观默认 `"completed"`**,
等 `action.result` 到了才覆写成真实状态(completed/failed/rejected)。所以在派生事实
(`facts.toolCalls`)这一层,"挂起中"和"成功完成"不可区分——`calledTool`/`notCalledTool`
的 `status` 匹配都建立在这个默认值之上。

## 修法

"某工具在这一轮还没执行"这类断言不要走 `notCalledTool(status)`,改对原始事件流查结果帧:

```ts
draft.eventsSatisfy((events) => {
  const ids = new Set(events.filter((e) => e.type === "action.called" && e.name === calc).map((e) => e.callId));
  return !events.some((e) => e.type === "action.result" && ids.has(e.callId) && e.status === "completed");
}, "no completed calculator result before approval");
```

落点:`e2e/shared/evals.ts` 的 `hitlApprove`。适用场景:任何想断言"调用已发起但尚未
执行/尚无结果"的 eval。注:整轮收尾后(deny→rejected、执行→failed/completed)结果帧
必然已落,`notCalledTool(status)` 在**收尾后的会话作用域**上是可靠的,坑只在挂起中的轮。
