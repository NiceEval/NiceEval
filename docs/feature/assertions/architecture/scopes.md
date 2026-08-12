# Assertions —— scope snapshots

完整模型见 [Assertions](../README.md)。断言范围（Assertion scope）方法在调用时直接登记 Boolean Assertion；它们不产生可由
另一条 API 再登记的中间对象。

## 三种 receiver

| receiver | 读取的 call-time snapshot |
|---|---|
| Turn | 该不可变 Turn。 |
| Session | 调用点之前的该 Session 前缀。 |
| 根 `t` | 调用点所有已启动 Session 的 vector cut。 |

Session 从第一次交互开始算已启动。仅创建空 handle 不会进入根 scope。于是早调用不会被未来事件补成
matched，早晚两个根 Assertion 可以得到不同结果。

Session scope 包含本 Session 在调用处之前的全部 Turn，因此 scoped tool Assertion 可以检查跨 Turn 的行为。根 `t` 冻结所有已启动 Session 的 vector cut，并按 Session 保留前缀。它不把独立 Session 拼成一条全局事件顺序。

`calledTool` 与 `notCalledTool` 的 selector、材料状态和三值计数只在 [Scoped assertions](../library/scoped-assertions.md) 定义。这里的 snapshot 规则决定那些方法在何处读取 occurrence，不另立匹配契约。

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
仍结算，未执行到的源码不会凭空产生结果。详细控制流见 [Assertions · `.orStop()`](../README.md#orstop)。
