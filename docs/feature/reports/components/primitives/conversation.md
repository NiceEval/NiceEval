# `Conversation`

`Conversation` 接收计划好的对话投影：

```tsx
<Conversation turns={turns} />
```

`turns` 来自 ConversationProjector 的 ReportData entry。
它保留角色、内容块、工具调用、工具结果、usage、截断事实、basedOn 和 verification；组件不读取 event、命令或 Store。

text 面按时间顺序输出紧凑对话，web 面输出语义化消息列表。
折叠与复制是渐进增强，初始 HTML 保留完整可读内容，展开不会增加 evidence request。

Sandbox lifecycle 命令是独立的已计划命令投影，不伪装成 Agent 消息。
命令的成功、非零退出和检查状态由 Projector 建立，renderer 只显示该判定。
