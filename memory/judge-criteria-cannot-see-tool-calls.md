# judge criteria 要求「基于工具作答」→ 恒判 0,因为默认材料看不到工具调用

## 现象

`examples/zh/ai-sdk` 的 `multi-turn.eval.ts` / `weather-tool.eval.ts`,agent 明明调了 `get_weather`
且回答正确(`t.calledTool` 全过),但

```ts
t.judge.autoevals.closedQA("是否…基于天气工具回答了北京天气问题?").gate(0.8);
```

恒判 0(gate → eval failed)。ClosedQA 的 rationale 说得很直白:「提交里没有任何证据表明这是基于
天气工具得到的…未显示工具调用或工具依据」。

## 根因

`t.judge` 的默认材料是 `conversationText(session.events)` —— **只拼 message 事件的对话文本,不含
action.called / action.result**。criteria 里要求 judge 验证「是否用了工具」,它在材料里永远找不到
证据,只能判 N → `score: 0`。而且这不是异常路径:collector 里没有 catch 触发、summary 里没有
detail,单看分数会误以为是模型答得差,实际是「让 judge 验证它看不见的东西」。

排查时的两个误导岔路(都验证过不是原因):代理的 judge 模型可用(`gpt-5.4` 直连 OK)、代理的
function calling 也通(autoevals 的 select_choice tool call 正常返回)。

## 修法

分工原则:**确定性能查的交给作用域断言,judge 只评它看得见的文本质量。**

```ts
t.calledTool("get_weather", { input: { city: "北京" } });          // 工具使用:确定性 gate
t.judge.autoevals.closedQA("是否给出了具体的天气信息(温度或天气状况)?"); // 回复质量:judge
```

写 closedQA criteria 时自查一句:「这个问题只靠对话文本能回答吗?」提到 工具/调用/基于返回数据
的措辞都是红旗。想让 judge 评过程,显式传 `{ on }` 喂事件流的序列化文本,别指望默认材料。

同类教训见 [[judge-agent-default-material]](默认材料假设错对象形态)、
[[loose-gate-regex-plus-soft-judge-false-pass]](judge 分数掩盖真实信号)。
