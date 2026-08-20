# Eval Trajectory —— 有向依赖路径上的分段执行

## 要消除的 Frog / DX 摩擦

有状态 Eval 往往靠数组顺序、Eval Group lane 或口头约定决定下一步。暂停后，操作者只能猜该接哪份状态；
恢复又容易把通用 carry 误当成已经完成的路径前缀。这样无法解释某个 Run 是否承接了准确的先前状态。

Eval Trajectory 依赖 [State](../state/README.md)。它以路径派生 identity 和显式 DAG 声明依赖，并为每个
暂停或恢复 segment 发布一份新的 immutable Run。resume locator 将 trajectory ID、旧 Run、trajectory execution、
frontier、Cohort、Region 和 exact `StateCheckpointRef` 绑成不可拆的一项交接事实。

## 核心心智

Eval trajectory 是一条由 Eval node 组成的有向无环图。文件路径给出 trajectory identity，key 给出 node identity；
作者必须写出每条依赖边。Eval Group 只拥有物理 Sandbox lane，既不表达这张图，也不拥有 checkpoint 前进。

一个可前进 node 以 `passed` 或 `failed` Verdict 结束，并且有确定的 accepted state commit、干净的 cleanup 和
可验证的隔离。`failed` 保留评分失败的语义，却可以使声明它为依赖的 node 开始。

`errored`、dirty、cleanup failure、isolation failure 或 commit indeterminate 都不能前进。它们不生成
resume locator，也不能被通用 carry 变成完整前缀。

comparability 从 `comparable` 只能降为 `debug`，绝不恢复。普通 start / resume 遇到 debug root、debug locator 或
State acquisition 的 debug downgrade 时 fail closed；操作者必须显式传 `--debug`，才能从 exact debug checkpoint
继续。debug handoff 携带封闭 reasons；它可由后续显式 `--debug` resume，但绝不进入 built-in comparison。显式
`--run <RunId>` 查看仍可读取它的 receipt。

## 范围

- 路径派生 trajectory / node identity，显式 DAG 边和精确 state predecessor。
- 一份 immutable Run 对应一个 start、planned breakpoint 或 resume segment。
- resume locator、专用 resumed-prefix provenance、单调 comparability 与可审计 CLI 交接。
- 受控 interruption、计划暂停、显式 debug downgrade、human / JSON 反馈与确定退出码。

Trajectory 不新增 Eval 类型、Plugin、Assertion、Verdict 或 Eval Group 语义。它不自动 merge 两条 state
分支，不按数组位置推导依赖，也不从时间、目录或可变指针选择 checkpoint。

## Owner 与身份

| 对象 | Owner | 身份规则 |
|---|---|---|
| trajectory definition | 文件路径 | `trajectories/**/trajectory.ts` 的规范路径派生 exact `TrajectoryId` |
| node | definition key | `TrajectoryId` 加 node key；不使用数组位置 |
| DAG | trajectory 作者 | node ID 与显式 `dependsOn` / `checkpointFrom` |
| trajectory execution | Runner | mint 的 execution ID 与绑定的完整 State cohort / region identity |
| segment Run | Evaluation producer | mint 的 `RunId`、完整 expected node IDs / slots 与 sealed receipt |
| resume locator | Runner | trajectory ID、旧 `RunId`、execution、frontier、Cohort、Region、exact checkpoint 与 debug reasons |

## Assertion 决策

本方向不新增 Assertion。真实公开 owner 是 `defineEvalTrajectory()` 的 DAG 和 State lifecycle；前者决定
节点能否依赖，后者证明 checkpoint 是否安全前进。每个 node 的 Eval 继续在 `test(t)` 内登记原有 Assertion，
Verdict 继续只表达这条 Eval 的评分结果。

生产可观察验收使用真实 State provider 生命周期、trajectory CLI 的 handoff 和跨 segment 的 E2E。它验证 immutable
Run、完整 expected slots、resume locator、failed 可前进、执行错误停止与显式 debug downgrade，而不以 fake 推演
同一张 DAG。

## 兼容与移除

公开面没有按 Eval Group、数组位置、通用 Run selector 或不带完整交接字段的 checkpoint 恢复路径。`start` 只接收
exact trajectory ID；迁入者必须写 `defineEvalTrajectory()` 的 explicit dependency，并从 State 得到 exact Cohort、
Region 和 `StateCheckpointRef`。既有 completed node 被引用时只能写 `resumed-prefix` provenance，不得写 `carried`。

旧有隐式 debug 恢复被移除：不带 `--debug` 的普通命令 fail closed；带 `--debug` 仍只接受 locator 绑定的 exact
debug checkpoint，不接受松散 identity。

## 入口

- [Library](library.md) —— declaration、DAG、frontier、Run ID 与 locator 形状。
- [CLI](cli.md) —— 两条唯一命令语法、dry、debug、handoff 与退出码。
- [Architecture](architecture.md) —— Run、expected slots、provenance、comparability 与并发边界。
- [Lifecycle](lifecycle.md) —— start、breakpoint、resume、失败、debug 与受控 interruption。
- [State](../state/README.md) —— Cohort、Region、exact checkpoint、CAS 与 fence。
- [Eval Group](../../feature/eval-groups/README.md) —— 独立的物理 Sandbox 复用 lane。
