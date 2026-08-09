# LangGraph

LangGraph 的接入面是官方 event streaming 协议转换器：

```ts
createLangGraphEventStream()
```

不提供 `langGraphAgent()` 工厂。
LangGraph 可以进程内运行，也可以部署在自建 HTTP 服务或 Agent Server 后；niceeval 不绑定其中一种 transport。

转换器应涵盖：

- `messages` channel 的 text、reasoning 与 tool-call content blocks；
- `tools` channel 的 started、finished 与 error，并按 tool call ID 配对；
- `input` / interrupt 到 `input.requested`；
- `lifecycle` 的 completed、failed 与 interrupted；
- `namespace` 中的 subgraph / subagent 层级；
- message finish 上可得的 usage；
- 协议 `seq` 所定义的事件顺序。

输入是现行官方 envelope：

```ts
type Event = {
  type: "event";
  seq?: number;
  method: "messages" | "tools" | "input.requested" | "lifecycle" | string;
  params: {
    namespace?: string[];
    timestamp?: string | number;
    node?: string;
    data?: unknown;
  };
};
```

`messages`、`tools` 与 `lifecycle` 的子事件写在 `params.data.event`。
HITL 使用顶层 `method: "input.requested"`，其 data 携带
`interrupt_id` 与 `payload`。未知 method 安全忽略，但其 `seq` 仍推进。
缺少原生 tool call ID 或 interrupt ID 的畸形帧不合成虚假 ID。

一个 converter 实例只消费一次官方 run。初始 run 与每次 resume 都新建
实例；`seq`、status、usage、去重与 namespace 生命周期均为 run-local。
`end()` 只负责冲刷已收到的 seq gap 并终结实例，重复调用幂等；终结后
`add()` 与 `markRejected()` 都失败。

人工拒绝时，consumer 必须在该 resumed run 的 `tool-error` 进入前调用
`markRejected(callId)`。该结果归一为 `rejected` 且不伪造 output。

Adapter 使用 `thread_id` 作为 `ctx.session.id`，并按应用协议把 `input.responses` 翻译成 `Command(resume=...)`。
这些 transport 与会话操作不进入转换器。

当前 `@langchain/langgraph@1.4.8` 的 `streamEvents({version: "v3"})` 可以直接提供
`ProtocolEvent` runtime 收据。无模型的图不会自然产出规范中所有 message/tool
帧。

interrupt runtime 也未必把 canonical `input.requested` 作为同一 method 发出。
确定性 owner 因此分开证明真实 runtime 兼容性与 typed Event 语义。后者不冒充
runtime 实测。

示例的目标形态：事件映射消费 LangGraph 官方协议，不各自手写重复的帧状态机；会话与 HITL 路径仍由示例的 adapter 自己承担。
示例见 [`examples/zh/tier1/langgraph/`](../../../../../examples/zh/tier1/langgraph/)。

确定性 owner 见 [SDK converter E2E](../../../../engineering/testing/e2e/adapter/sdk-converters.md#langgraph-core-deterministic)。
