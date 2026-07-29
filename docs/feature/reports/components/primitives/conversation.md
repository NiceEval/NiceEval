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
