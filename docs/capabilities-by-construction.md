# Capabilities by Construction —— 能力由构造证明,不再有声明式布尔位

> **状态:已实现。** 本文最初是一份设计提案(「为什么能力是布尔变量,而不是实现了某个函数就算有?」),写作时 `AgentCapabilities` 布尔位系统还在。实现落地时走得比提案本身更彻底:提案设想的是"能证明的位由推断决定,证明不了的位保留声明、默认翻转为 false";实际做法是**整个 `capabilities` 字段连同它的类型 `AgentCapabilities` 一起从 `Agent` 接口删除**,包括提案里"仍然保留声明"的 `conversation`。本文记录这次实现和最初提案的差异,以及哪些部分至今仍未落地。

## 现状:`Agent` 接口上没有能力位

`src/agents/types.ts` 的 `Agent` 接口只有 `name` / `kind` / `setup` / `tracing` / `spanMapper` / `send` / `teardown`,没有 `capabilities` 字段。`t` 上解锁什么完全按下表由构造证据决定:

| 能力 | 证据 | 用户要写什么 |
|---|---|---|
| `t.sandbox`、`t.sandbox.fileChanged()` 等文件系统断言 | `defineSandboxAgent` 构造(`kind: "sandbox"`) | 无——`defineAgent` 构造的 agent(`kind: "remote"`)调用这些方法会立即得到清晰报错,这是唯一仍需要运行时守卫的能力(`src/context/context.ts` 的 `capabilityGuard`) |
| 多次 `t.send()`、`t.reply`、`t.newSession()` | `send` 里接了 `ctx.session` 的续接存取器(`history<TMsg>()` 或 `id` + `capture(id)`) | 无——没接就每轮各是新对话,不报错,只是断言看不到跨轮历史 |
| `t.calledTool()` 等正断言 | `send` 返回的 events 里有 `action.*` | 无——有事件就能断,没有就是断言 fail(响,不静默) |
| `t.notCalledTool()` / `usedNoTools()` 等负断言的**可信度** | 事件来源是否有完整性契约(SDK 原生事件流透传、`fromAiSdk` 的 `result.steps`、Responses 的 `output`) | 无——但手写映射时如果知道自己漏了工具层,应在 eval README 里如实说明这条 eval 的负断言不可信,而不是假装它和正断言一样可靠 |
| `t.respond()` / `t.parked()` 等 HITL | `send` 返回过 `status: "waiting"` + `input.requested` 事件 | 无——做到了就是有,提案写作时这条已经是行为证明,现状延续 |
| `EvalResult.trace`、`niceeval view` 瀑布图 | 配置了 OTel 接入(agent 的 `tracing` 块,或 remote agent + `defineConfig({ telemetry })`) | 无——块/配置本来就要写,不需要额外声明 |

对照最初提案的分类表(`sandbox`/`workspace` 构造即证明、`tracing` 块即证明、HITL 行为即证明、`conversation`"任何一层都证明不了、保留声明"),唯一的方向性差异在 `conversation`:提案认为对端是否真续接谁都证明不了,所以要保留一个显式声明;实现干脆**连这个声明也删了**——用户不写任何东西,`t.send()` 能不能带上历史,完全取决于 `send` 有没有实际使用 `ctx.session.history()` 或 `ctx.session.id`/`capture()`。这不是"证明了对端续接"(确实证明不了),而是"不再需要证明"——没有能力位意味着没有"承诺"这个概念,只有"这段代码写了什么就是什么"。

最小接入现在是:

```ts
// 不声明 = 不承诺,零心智负担;t.send() 只有一轮、t.calledTool() 只有事件里有才断得到
export default defineAgent({
  name: "my-bot",
  async send(input, ctx) { /* ... */ },
});
```

## 和最初提案不同、至今仍未实现的部分

提案第二层设想了一套"认证来源"机制:`fromAiSdk` 这类官方转换器的返回值携带一个不可枚举的证明标记(`certify({ events, usage, status }, { toolObservability: true })`),runner 按 attempt 聚合"是否全部事件都来自带证明的来源",从而让负断言的可信度变成一个运行时可判定的状态,证明不够时打 warning。**这套 `certify()` 机制没有实现**——源码里搜不到 `certify` 或任何等价的证明标记传递逻辑,`t.notCalledTool()` 在 `src/scoring/scoped.ts` 里就是纯粹的计数判断,不检查事件来源。

现状是:**负断言的可信度完全是文档层面的判断,不是运行时机制。** 官方转换器(`fromAiSdk`、`fromClaudeSdkMessages` 等)透传的是 SDK/协议本身承诺完整的事件流,所以文档上说这些来源"负断言可信";手写映射没有这份契约,文档上说"负断言提示不可信"——但这只是写在文档里提醒 eval 作者自行判断,niceeval 不会在运行时警告或标记。这是提案与实现之间最大的落差,以后如果要补,`certify()` 一节的设计仍然是现成的起点。

`compactionObservability` 同理:没有单独的能力位,`send` 吐了 `compaction` 事件,`t.event("compaction")` 就能断到,吐了多少算多少,不存在"完整性证明"这层。

## 边界

- **默认值问题已经不存在。** 提案担心的"`defineAgent` 默认给 `conversation: true, toolObservability: true`,教程第一步要写一行反悔"——这个问题连同整个 `capabilities` 字段一起消失了,不需要保留"opt-out 默认值"这个概念。
- **`workspace` 对远程 agent 依然不放开。** 文件系统断言(`t.sandbox`、`t.sandbox.fileChanged()`)只在 `kind: "sandbox"` 上解锁,远程 agent 即便自己改了文件,也没有 sandbox 提供的 diff 基线,这条边界和提案设想的一致。
- **`t.newSession()` 在没有接会话续接存取器时依然可以调用。** 新会话线的第一轮就是存取器的自然空态,不需要判断"这个 agent 支不支持多轮"。

## 相关阅读

- [adapters/contract.md](adapters/contract.md) —— 逐能力的构造证据、逐 API 的适配义务、负断言完整性规则。
- [Observability · OTLP traces](observability.md#otlp-traces--统一瀑布图) —— OTel 现在只喂 trace 瀑布图,和这里讨论的事件类能力完全独立。
- docs-site [Adapter 概念](../docs-site/zh/concepts/adapter.mdx) —— 面向用户的「能力从哪来」讲法,与本文现状一节一致。
