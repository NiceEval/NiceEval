# Plugins —— Lifecycle

## 两条既有生命周期

Experiment host lifecycle 是独立 Run scope：

```text
Experiment author setup
  → Experiment plugins[].lifecycle.setup
  → all selected Eval pairs
  → Experiment plugins[].lifecycle.teardown (reverse)
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
- Experiment lifecycle 失败：沿用 `experiment.setup` / teardown 语义。
- Sandbox contribution 失败：沿用其实际 `sandbox.prepare.*` 或 physical phase。
- Agent extension 失败：沿用 receiver 对应的 `agent.setup` / teardown 语义。
- 用户中断与强清：复用现有 Scope / teardown registry；Plugin 不启动 detached cleanup runtime。

## Dry plan

`niceeval exp ... --dry --commands` 展示 attachment、owner、Plugin identity、requirements、SandboxCommand 与 receiver manifest 摘要。它不求值 auth binding、不显示 secret、不执行实机探测；receiver 不支持、重复 identity、slot 冲突及计划 requirement 可以在零资源阶段发现。
