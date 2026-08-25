# Assertions —— scope snapshots

完整模型见 [Assertions](../README.md)。断言范围（Assertion scope）是 root `t`、Session 与 Turn。
三者都暴露 `toolCalls`、`eventOccurrences`、原始 `events` 与 `check`。
工具领域包装取 ctx-owned collection 并调用同一 `check`。
event 领域包装对 `eventOccurrences` 做同一件事。`toolCalls` 与 `eventOccurrences` 是冻结的 managed collection subject，
不是已求值的 Assertion；`events: readonly StreamEvent[]` 仍是普通 Value subject，没有 occurrence sidecar。

## 三种 receiver

| receiver | getter 冻结的 snapshot |
|---|---|
| Turn | 该不可变 Turn 的 `toolCalls`／`eventOccurrences` 封口 cut。 |
| Session | 该次 getter 之前的 Session `toolCalls`／`eventOccurrences` 前缀。 |
| 根 `t` | 该次 getter 时所有已启动 Session 的 `toolCalls`／`eventOccurrences` vector cut。 |

Turn 封口后，重复读取 `turn.toolCalls` 或 `turn.eventOccurrences` 内容相同。
Session 与 root 每次 getter 冻结当下 cut；后一次 getter 可以看到更新，旧引用永不变化。
`check` 使用 subject 携带的 scope identity 与 cut，不按调用 `check` 的 ctx 重新裁切。

Session 从第一次交互开始算已启动。仅创建空 handle 不会进入根 scope。于是早读取的 collection 不会被未来事件补成
matched，早晚两次 getter 可以得到不同引用。

Session scope 包含本 Session 在 getter 处之前的全部 Turn，因此 scoped tool Assertion 可以检查跨 Turn 的行为。根 `t` 冻结所有已启动 Session 的 vector cut，并按 Session 保留前缀。它不把独立 Session 拼成一条全局事件顺序。

`toolCalls`、`eventOccurrences`、collection Match 与包装的 selector、材料状态和三值计数只在 [Scoped assertions](../library/scoped-assertions.md) 定义。这里的 snapshot 规则决定 collection 在何处读取 occurrence，不另立匹配契约。

## `succeeded`

`succeeded` 读取可信终态和 unresolved HITL。它不是 `noFailedActions` 的别名：一次 action 失败后如果
协议恢复为 completed，`succeeded` 可 matched，而 `noFailedActions` 保持 mismatched。

协议终态为 failed 时 `succeeded` mismatched。只有消息文本含“502”而协议为 completed 时，不猜测失败。
Adapter 或 transport 不能给出可信 snapshot 时，Attempt 是 execution error。Judge evaluator 的失败不影响
`succeeded`。

根 `t.succeeded()` 在零活动时确定地 mismatched。运行中或没有可信终态的 scope 不能被当作 completed，
也不能用 last status 代替 vector cut。

## 停止

scoped Boolean handle 可 `await .orStop()`。mismatch 会设置 authoring stop latch；已登记 scope Assertion
仍结算，未执行到的源码不会凭空产生结果。`stop` 的持久 source site 只保存实际执行的位置；详细的
handle 规则见 [Assertions Library](../library.md#handle-配置)。
