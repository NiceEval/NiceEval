# OpenAI 兼容（Chat Completions / Responses）

`turnFromChatCompletion(res)` 与 `turnFromResponses(res)` 把 OpenAI 两种响应形状转换成 `Turn`。
目标对象进入名字，因为 `niceeval/adapter` 是扁平入口；名称同时表达协议出处与 Turn 返回值：

```ts
import {
  chatCompletionEvidenceCoverage,
  defineAgent,
  turnFromChatCompletion,
  turnFromResponses,
} from "niceeval/adapter";

// Chat Completions 形状
const agent = defineAgent({
  name: "chat-completions-agent",
  evidenceCoverage: chatCompletionEvidenceCoverage,
  async send({ text }) {
    const res = await client.chat.completions.create({ model, messages: [...history, { role: "user", content: text }] });
    return turnFromChatCompletion(res);
  },
});

// Responses 形状
return turnFromResponses(await client.responses.create({ model, input: text }));
```

两个转换器接受结构化的 `*Like` 类型，不依赖 `openai` 包。声明使用这两种协议
形状的网关、代理或兼容实现都能调用它们。

两份 `EvidenceCoverage` 与转换器同包导出。它们声明协议形状本身能证明的通道；
Adapter 增加旁路 transcript 后，可以在自己的声明里据实升级。

- Chat Completions 的 `function` 与 `custom` tool call 变成
  `operation.started`。deprecated message-level `function_call` 不在契约内。
- Responses 的 `function_call` 变成 `operation.started`；`content` 和
  `output_text` 变成 `message`。
- 未知的未来 tool/output variant 安全忽略。
- `usage` 按恒互斥桶落值，cached 子集从输入总量扣出。口径见 [cost](cost.md)。

两种形状对负断言的可信度不同：

- **Chat Completions** 不承诺「响应 = 完整过程」——应用可能在服务端跑完工具循环，只把最终答案给你。
  `notCalledTool` 这类负断言只能当「没看到」，不能当「确实没发生」。
- **Responses** 的 `output` 数组提供这一轮返回的 items；converter 会忽略未知
  item type，因此 actions/events coverage 是 partial，不能把未识别的未来 item
  当成「确实没发生」。

这条差异体现在转换器声明的证据完整性上，两者产出的 `Turn` 形状本身相同。
用户侧写法与「零映射」表格见 [docs-site 的 send 指南](../../../../../apps/docs-site/zh/tutorials/write-send.mdx)。

确定性 owner 用 `openai@6.49.0` 的官方客户端完整返回值直入 converter；live
owner 各用一次真实 Chat Completions 与 Responses 请求完成兼容性验收。见
[确定性 E2E](../../../../engineering/testing/e2e/adapter/sdk-converters.md#openai-chat-completion-deterministic)
与 [live E2E](../../../../engineering/testing/e2e/adapter/openai-compat.md)。
