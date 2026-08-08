# 分组 Sandbox 复用 —— Lifecycle

契约总纲见 [README](README.md)，调度与错误见 [Architecture](architecture.md)。

## fresh 与分组复用

| 节点 | 未分组 fresh | 一个复用组 |
|---|---:|---:|
| Provider Case create / physical release | 每 Attempt | 每台实际实例；同一时刻至多一台 |
| Sandbox lifecycle setup / teardown | 每 Attempt | 每台实际实例一次 |
| 题间 reset | 无题间复用 | 每条组内 Attempt 进入前 |
| 两层 prepare 与 agent.ensure | 每 Attempt | 每 Attempt |
| Agent runtime 与 Eval test | 每 Attempt | 每 Attempt |
| 实例不可用后的动作 | 不适用 | 按 `onUnavailable` 停组或替换 |

两种生命周期都在每条 Attempt 建立独立归因区间。
共享 Sandbox 不合并判定、usage、diff、事件或 locator。

## 组内时序

```text
首条真实派发
  -> create -> lifecycle setup -> reset point
  -> reset -> prepare -> agent.ensure -> Agent -> test -> cleanup
  -> 实例安全：归还本组
     实例不可用：stop-group 或 replace-sandbox
  -> 组内最后一条工作封口
  -> lifecycle teardown -> physical release
```

Sandbox 在两个 Attempt 之间可以空闲。
空闲不占 Attempt 并发位，但仍占 Provider 资源并计入该组的 active 数。

## `stop-group`

实例不可用后，Runner 不创建替代 Sandbox。
该组尚未派发的工作不进入 Agent、Eval 或 Judge 生命周期，Run completion 记为 incomplete。

Runner 追加 `sandbox-reuse-group-stopped` diagnostic。
它包含 group id、最后一条 Attempt、原始故障和未派发 Eval；其它组与 fresh Attempt 继续运行。

## `replace-sandbox`

实例不可用后，Runner 先完成旧实例仍可执行的 teardown 与 physical release，再创建新实例。
新实例重新执行 lifecycle setup、建立 reset point，并从该组下一条尚未派发的 Attempt 继续。

替换不重跑已经产生模型成本的 Attempt。
运行数据递增 `sandboxNumber` 与 replacements，让读取面明确知道同组结果来自多台先后使用的 Sandbox。

## carry 与零资源路径

组成员可携带时，Runner 不为它领取 Sandbox、不运行 lifecycle hook，也不占并发位。
只有本 Invocation 中真实派发的组成员才共享实例。

Sequence Invocation 每一步都 fresh dispatch。
它与 `stop-group` 组合时，从首步建立实例并一直使用到序列封口；外部 cohort 是否干净仍由 lifecycle 与 `sharedState` 保证。

## 中断与收尾

Invocation 中断时，Runner 停止派发新工作，并按以下顺序收尾每台已创建的 Sandbox：

1. 中止在飞 Agent 与命令；
2. 执行本 Attempt 的 Agent teardown 与已登记 cleanup；
3. 结束该组，不在中断收尾中触发替换；
4. 执行 Sandbox lifecycle teardown；
5. 按 [Sandbox 默认停驻与回收](../sandbox-retention/lifecycle.md)执行 physical release。

未派发成员不产生伪 Attempt。
下一次运行重新做普通携带或 Sequence 完整重新执行规划。

## 与默认停驻组合

组实例退出调度 owner 后，按 [Sandbox 默认停驻与回收](../sandbox-retention/README.md)求值一次 release policy。
正常实例停在 reset anchor，使用 `pool-reset-anchor-post-teardown` checkpoint。
默认 `retain: "failed"` 不选择它，因此直接销毁。

因失败或不安全状态退休的实例不执行题间 reset。
它使用 `pool-retired-post-teardown` checkpoint，并保存最后一条 locator 与 assignment history。
history 不表示 Sandbox 实例属于某条 Attempt。

`localSandbox()` 没有可恢复的隔离边界，同样不能加入复用组。
