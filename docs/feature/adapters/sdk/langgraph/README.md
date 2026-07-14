# LangGraph

LangGraph 的接入面是官方 event streaming 协议转换器：

```ts
fromLangGraphEvents()
```

不提供 `langGraphAgent()` 工厂。LangGraph 可以进程内运行，也可以部署在自建 HTTP 服务或 Agent Server 后；niceeval 不绑定其中一种 transport。

转换器应覆盖：

- `messages` channel 的 text、reasoning 与 tool-call content blocks；
- `tools` channel 的 started、finished 与 error，并按 tool call ID 配对；
- `input` / interrupt 到 `input.requested`；
- `lifecycle` 的 completed、failed 与 interrupted；
- `namespace` 中的 subgraph / subagent 层级；
- message finish 上可得的 usage；
- 协议 `seq` 所定义的事件顺序。

Adapter 使用 `thread_id` 作为 `ctx.session.id`，并按应用协议把 `input.responses` 翻译成 `Command(resume=...)`。这些 transport 与会话操作不进入转换器。

示例的目标形态：事件映射消费 LangGraph 官方协议 fixture，不各自手写重复的帧状态机；会话与 HITL 路径仍由示例的 adapter 自己承担。示例见 [`examples/zh/tier1/langgraph/`](../../../../../examples/zh/tier1/langgraph/)。
