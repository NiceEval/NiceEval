# Plugins —— Lifecycle

## 两条既有生命周期

Experiment host lifecycle 是独立 Run scope：

```text
Experiment author setup
  → Experiment plugins[] 的 experiment.setup
  → all selected Eval pairs
  → Experiment plugins[] 的 experiment.teardown (reverse)
  → Experiment author teardown
```

每个 Plugin occurrence 每 Run 至多执行一次。Eval Plugin V1 不新增 host lifecycle。

Sandbox / Agent lifecycle 由 template owner 决定组合链：

```text
template-owner author layer
  → template-owner plugins[]
  → other-owner author layer
  → other-owner plugins[]
  → agent.ensure
  → receiver-composed Agent setup / postSetup
  → Eval body / Agent send
  → receiver-composed preTeardown / Agent teardown
  → Sandbox cleanup in exact reverse registration order
```

`template-owner` 是 Eval 时，先走 Eval author/plugins；是 Experiment 时，先走 Experiment author/plugins。Plugin 不新增 `plugin.*` phase。Agent receiver 把 extension 编入 Adapter 已有槽位，不产生统一的 “plugin agent setup”。

Eval hook 使用既有 `EvalHookContext`。它提供本 Attempt 的 `agent`、`sandbox`、`AbortSignal`、`progress()`、
`diagnostic()` 与声明受限的 `record()`，不提供跨 Attempt mutable store 或开放持久化存储。

Plugin 直接返回 `before` 与 `after`。before 在 Agent 已 ready、进入 Eval test 前按 Plugin 声明顺序运行；进入该 Plugin 节点后立即登记它的 after。省略 before 时仍登记 after。after 在 test 成功、抛错或中断后按登记逆序运行，再进入 Agent 与 Sandbox 收尾。

before 失败时不运行尚未进入的 hook；已登记 after 仍运行。多个失败沿用 Scope 的主错误加 teardown errors 判定，不用 after 替换 test / before 主错误。它们仍归既有 `eval.run`，不新增 phase。

## Record write 时点

Plugin 只能经 blueprint 已声明的
[producer write grant](../record-attachment-authoring/library.md#producer-write-grant) 写入。Eval hook 只取得自己的
occurrence-local Attempt context，
Experiment hook 只取得 Run context；两者都必须发生在对应 Record owner 封口前。Group 没有 runtime write
context。

同一 owner + family 的第一次调用原子取得 reservation，第二次调用稳定返回中立 duplicate failure。

owner seal 依次关闭 external occurrence grants、drain 其 commands，并根据 accepted events 写 Plugin provenance。
随后关闭 built-in grants、停止 owner-wide admission，再 drain 到静止。

closed、wrong-owner、undeclared、payload、closure 与 blob failure 不降级为 diagnostic，也不会改写已有 Attachment。
完整并发、封口与中断语义见
[RecordAttachment Lifecycle](../record-attachment-authoring/lifecycle.md)。

## Sandbox resource 时序

需要跨 pair 聚合的 resource 先于 physical create 完成纯规划：

```text
selection / pair link / group compatibility
  → selected demand cohort
  → receiver aggregate + validate
  → aggregate projection 写入每个 pair fingerprint / manifest
  → carry planning
  → 若存在真实派发：
      physical Sandbox create
      → existing sandbox.setup
      → 官方 resource materialize / verify（按首次 Plugin 出现的确定顺序）
      → reset anchor
      → 每条 Attempt：
          workdir reset
          → 原生 SandboxLayer prepare chain（Git checkout 保留 Plugin 位置）
          → agent.ensure / Agent / Eval / cleanup
      → resource teardown（按已 materialize 顺序逆序）
      → existing sandbox.teardown
      → Provider finalizer
```

existing `sandbox.setup` 单独不足以承担 resource：它没有 fingerprint 前的 cohort aggregate，也不能为全部成员写入同一投影。resource materialize 仍绑定 physical instance，不建立 group scope。

## 资源作用域

| Scope | 状态粒度 | setup 次数 | teardown 次数 |
|---|---|---:|---:|
| Experiment | 一个 Experiment attachment occurrence / Run | 至多一次 | 到达 setup 时点后至多一次 |
| physical Sandbox | 一个实际 Sandbox 实例 | 实例创建后一次 | 实例退休前一次 |
| Attempt / Agent | 一个 Attempt | 每条一次 | 到达 setup 时点后每条一次 |

成对节点在进入 setup 前登记 finalizer。setup 中途抛错不豁免自身 teardown；未到达的节点不产生虚假收尾。Sandbox chain teardown 按实际登记的完整组合链逆序。并发 Attempt 各有独立 scope，不存在跨 Attempt 的全局 LIFO。

## 失败与中断

- selection / link / planning requirement 失败：创建资源前聚合，列出 Plugin identity、attachment、owner 与 pair。
- attachment 不支持：TypeScript 拒绝；动态 JS 在 definition 阶段报错。
- 两侧 identity 重复或槽位冲突：pure link 失败。
- attachment family 重复、owner 不匹配或未声明：typed capability failure。
- Experiment lifecycle 失败：沿用 `experiment.setup` / teardown 语义。
- SandboxLayer 失败：沿用其实际 `sandbox.prepare.*` 或 physical phase。
- Agent extension 失败：沿用 receiver 对应的 `agent.setup` / teardown 语义。
- 用户中断与强清：复用现有 Scope / teardown registry；Plugin 不启动 detached cleanup runtime。
- resource `demand-invalid`：零资源 planning failure，不重试。
- resource `demand-unsatisfied`：静态需求在 materialize 后仍不可满足，停止 cohort，不以 replacement 重试同一错误。
- resource `instance-unavailable`：实例退休，按 group 的 stop / replace policy；fresh Attempt 直接失败。
- resource `attempt-consume-failed`：当前 Attempt errored 且实例退休，尚未派发项按 group policy。

`sandboxReuse: true` 没有 group 的 `onUnavailable` 替换开关。`instance-unavailable` 或 `attempt-consume-failed` 会退休当前实例；失败 Attempt 保持 errored，尚未派发项沿用既有 Experiment reuse policy，在新实例重新 materialize 后继续。静态 `demand-unsatisfied` 仍停止整个 cohort。

## Dry plan

`niceeval exp ... --dry --commands` 展示 attachment、owner、Plugin identity、requirements、SandboxCommand 与 receiver manifest 摘要。它不求值 auth binding、不显示 secret、不执行实机探测；receiver 不支持、重复 identity、slot 冲突及计划 requirement 可以在零资源阶段发现。
