# `Conversation`

`Conversation` 接已经投影好的 `turns`：

```tsx
const turns = await toConversationTurns(attempt);
return <Conversation turns={turns} />;
```

它保留角色、内容块、工具调用、工具结果、usage 与截断事实。
组件不读取 events.json，也不把缺失的请求或 token 补成零。

text 面按时间顺序输出紧凑对话；web 面输出语义化消息列表。
折叠与复制是渐进增强，初始 HTML 保留完整可读内容。

Sandbox lifecycle 命令不是 Agent 消息，不进入 `Conversation`。
Attempt 详情把 `commands.json` 的 `checked` 调用事实与 exitCode 在消费层推导成独立命令证据区块——成功、非零两种情况都记，不再只有失败才可见。
`exitCode === 0` 是中性 succeeded，非零时 unchecked 是中性 observed，checked 才是 failed。这样 setup 命令不会被追加在所有 Turn 之后，也不会借用对话卡片冒充 Agent 行为。
