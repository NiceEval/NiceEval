# OpenAI 兼容（Chat Completions / Responses）

`turnFromChatCompletion(res)` 与 `turnFromResponses(res)` 把 OpenAI 两种响应形状转换成 `Turn`。
目标对象进入名字，因为 `niceeval/adapter` 是扁平入口；名称同时表达协议来源与 Turn 返回值：

```ts
import { turnFromChatCompletion, turnFromResponses } from "niceeval/adapter";

// Chat Completions 形状
const agent = defineAgent({
  async send({ message }) {
    const res = await client.chat.completions.create({ model, messages: [...history, { role: "user", content: message }] });
    return turnFromChatCompletion(res);
  },
});

// Responses 形状
return turnFromResponses(await client.responses.create({ model, input: message }));
```

两个转换器接受结构化的 `*Like` 类型，不依赖 `openai` 包。任何声明自己走这两种协议形状的服务
（网关、代理、兼容实现）都能用。`tool_calls` / `function_call` 变成 tool
`operation.started`，对应结果变成 `operation.finished`；`content` / `output_text` 变成
`message`。`usage` 按恒互斥桶落值，cached 子集从输入总量里扣出，口径见 [cost](cost.md)。

两种形状对负断言的可信度不同：

- **Chat Completions** 不承诺「响应 = 完整过程」——应用可能在服务端跑完工具循环，只把最终答案给你。`notCalledTool` 这类负断言只能当「没看到」，不能当「确实没发生」。
- **Responses** 的协议契约里 `output` 数组记录了模型这一轮决定做的全部事（包括每个 `function_call`），负断言可信。

这条差异体现在转换器声明的证据完整性上，两者产出的 `Turn` 形状本身相同。用户侧写法与「零映射」表格见 [docs-site 的 send 指南](../../../../../docs-site/zh/tutorials/write-send.mdx)。
