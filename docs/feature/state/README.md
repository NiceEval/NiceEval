# State —— 跨 Attempt 延续实验状态

State 让一个 Experiment 显式载入与回存跨 Attempt 的外部状态,例如记忆库、累积笔记或可归档的用户目录。
它解决的是「下一条 Attempt 从哪份 checkpoint 继续」,不是装工具、准备题目或复用 Sandbox。

```typescript
import { defineExperiment, defineExperimentState } from "niceeval";

export default defineExperiment({
  agent: codexAgent(),
  sandbox: mempalSandbox,
  state: defineExperimentState({
    identity: {
      store: "memorybench-host-checkpoint",
      cohort: process.env.MEMPAL_COHORT ?? "local",
      schema: 1,
    },
    consistency: { mode: "rolling" },
    saveOn: "after-load",
    load: mempalLoad,
    save: mempalSave,
  }),
  maxConcurrency: 1,
});
```

## 核心心智

- **State 只属于 Experiment。** Eval 描述题目,不能选择跨题的状态序列。
- **状态住在 Sandbox 外。** `load` 把 checkpoint 恢复进当前 Sandbox,`save` 把当前状态提交回外部 store。
- **State 晚于准备、早于 baseline。** 两层 Sandbox command 与 `agent.ensure` 完成后才 load;Agent teardown 完成后才 save。
- **一致性由声明决定。** `pinned` 每次都从固定 revision 起步;`rolling` 把成功 save 的 checkpoint 作为后继。
- **没有 state 就是无状态。** Runner 内部使用 `Stateless` 分支,不造空 callback 或虚假 phase。

State 不承担以下职责:

- Agent CLI 与依赖安装属于 [Agent Ensure](../adapters/architecture/agent-ensure.md) 和 [Sandbox prepare command](../sandbox/prepare-commands.md)。
- 题目 fixture 属于 Eval layer 或 `test(t)`。
- Sandbox 的创建、reset 与窗口寿命属于 [Sandbox Case](../sandbox/case.md) 和 [Sandbox 复用](../sandbox/reuse.md)。
- 一次 Run 的宿主机共享服务属于 Experiment `setup` / `teardown`。

## 两种一致性

| 模式 | 起点 | save 后的 checkpoint | 携带 |
|---|---|---|---|
| `pinned(revision)` | 每个 fresh Attempt 或 reuse window 都核对同一 revision | 只作本次输出,不成为下一次起点 | 可按普通 fingerprint 规则携带 |
| `rolling` | 首次读 store head,以后读上一笔成功提交 | 成为同 cohort 的唯一后继 | 禁止跨 Run 携带 |

`rolling` 把一次 load 到对应 save 视为临界区,因此 Experiment 必须声明 `maxConcurrency: 1`。
需要多个独立序列时,拆成不同 Experiment 或不同 cohort,不要在 callback 内另造一把框架看不见的锁。

## 相关阅读

- [Library](library.md) —— 公开 API、checkpoint、`saveOn` 与真实 mempal 写法。
- [Architecture](architecture.md) —— 内部 ADT、fresh / reuse cadence、fingerprint、失败和 Effect Scope。
- [Sandbox 三方准备时序](../sandbox/lifecycle.md) —— State 在完整 Attempt 生命周期里的位置。
- [Experiments](../experiments/README.md) —— `state`、`sandboxReuse` 与 `maxConcurrency` 的组合入口。
