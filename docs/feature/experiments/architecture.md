# Experiments —— 架构

Experiment 是可签入的运行配置。
它选择 Eval、声明 Agent 和调度条件；Record 定义事实怎样持久化、怎样被证明与读取。
本页只定义两者的接缝，Record 的实体、Claim、Contribution、receipt 与 Store 事务形状始终以 [Record](../record/README.md) 为准。

## 实体与生命周期

一个 `.niceeval` 对应一个长期 `RecordStore`。
它跨多次 Invocation、多个 Experiment 与多个 Run 持续追加，不按 Experiment 或时间创建第二个事实根。

```text
ExperimentDefinition
  -> 求值后的运行配置与 Run Provenance
  -> Invocation(invocationId)
  -> 每个选中 Experiment 一个 Run graph entity
  -> 每个 membershipSlot 一个 current RunContribution
  -> immutable RecordGraphRef
```

Runner 在开始调用时取得 `invocationId`，并以它建立 Live、外部 Invocation 索引与最终 receipt。
它为每个选中的 Experiment 建立一个 Run；Run 同时带有一个 `experimentId` 和一个 `invocationId`。
Invocation 不是 Record entity catalog 的成员，因此一次 Invocation 可以有零到多个 Run。

Run 是 graph entity，不按 Experiment 与时间拆成目录、文件或独立 Record root。
每次成功提交都返回新的不可变 `RecordGraphRef`；其 `previous` chain 保留历史，Store 的 committed roots 也保留每个已返回 receipt 可重开的 revision。

Attempt 只属于实际创建它的 origin Run。
每个 Run revision 对每个 `membershipSlot` 只保存一个 current Contribution strong edge；slot 与 `contributionId` 稳定对应，Sample 因而能在固定 GraphRef 上逐槽读取成员。

```text
origin Run -- owns --> Attempt

target Run -- slot --> RunContribution -- adopted --> Attempt revision
                         executed | carried | accepted | renamed
```

`executed` 代表该 Run 实际执行的 Attempt。
`carried`、`accepted` 与 `renamed` 都只采用已有 Attempt 的明确 revision，绝不复制或 reparent Attempt、Verdict、evidence、Observation 或 locator。

每个非执行采用都以具名 Claim 说明理由，并将该 Claim 的完整 typed ref 放进 `basisClaims`。
Claim 的 `kind`、`schema`、`value`、evaluator 与证据仍使用 Record 的通用 Claim 形状；Experiments 不另立结果 payload 或出处字段。

迟到事实先写入同一 `attemptId` 的后继 Attempt revision。
随后同一 `contributionId` 形成线性后继，采用该 Attempt revision，并由对应 Run 的后继 revision 更新 current strong edge。
它不能借迟到事实换 Attempt、换 slot 或制造另一个 locator。

## 配置求值链：一次求值，处处同源

配置优先级是 CLI flag → Experiment 字段 → Eval 字段 → `niceeval.config.ts` 回退 → 默认值。
凭据变量与宿主条件不参加这条链。

| 字段 | 求值链 | 默认 |
|---|---|---|
| `timeoutMs` | `--timeout` → Experiment → Eval → config | 无上限 |
| `judge` | 单条断言 → Experiment → Eval → config | 未配置 Judge 时在需要它的断言处报错 |

`judge` 按字段合并。
Experiment 只能配置 Judge 的执行条件；rubric、评分材料、Severity 与 threshold 仍由 Eval 的 assertion 定义。

`model`、`baseUrl` 与 `timeoutMs` 是 Judge 执行配置的一部分。
`apiKeyEnv` 只声明凭据位置，不进入运行配置的可比性身份，也不写入事实。

所有消费者使用同一份已求值配置：调度、指纹、Run Provenance、Claim 与人读反馈不能重新各算一份。
人读反馈可以标出有效值来自 flag、Experiment、Eval 或 config；这个解释不另成为持久实体。

求值后的静态运行配置进入该 Run 的注册 Provenance。
它不是额外的 Run 摘要、文件投影或第二套 Record payload；读取方通过 Record 打开 Provenance，而不是依赖路径推断配置。

## Run 级共享准备：构建协调的预算

Eval 需要按需构建 Sandbox 时，BuildKey 构建、共享拉取与发布属于 Run 级活动，而不属于任何 Attempt。

- 共享准备受独立构建并发、逐 key timeout、全局准备上限与 Invocation abort 约束，不占 Attempt 并发位。
- Attempt deadline 从取得构建输出并开始创建 Sandbox 时计算；创建实例、准备、Agent Ensure、执行与判分共用该 Attempt 的 deadline。
- 共享准备的时长与 Diagnostic 是 Run 范围的 Observation。Live 把它显示成运行级活动，不把它写入某个 Attempt 的时间。

完整的调度和 Sandbox 规则由 [Sandbox · Run 级构建协调](../sandbox/case.md#run-级构建协调共享准备的预算与调度) 定义。

## 实验级生命周期：setup 与 teardown

`setup(ctx)` 与 `teardown(ctx)` 在宿主机上执行，每个 Experiment Run 最多各一次。
它们只负责该实验所有 Attempt 共享的资源；Sandbox 内准备仍归 Eval 或 Experiment 的 `SandboxLayer`，Agent 安装归 Adapter，跨实验常驻服务归外部编排。

```ts
let tunnel: Tunnel | undefined;

export default defineExperiment({
  async setup(ctx) {
    tunnel = await startTunnel();
    ctx.fact("tunnel", tunnel.url);
  },
  async teardown() {
    await tunnel?.stop();
  },
});
```

Experiment Hook 的 `fact()` 产生 Run 范围 Observation。
Attempt 作用域的 `fact()` 产生 Attempt Observation；二者都由 Record 的 event stream 保存，而不是补写成 Run 的结果字段。

第一个真正获准派发的 Attempt 才触发 `setup`。
全部成员都由 carry、accept 或 rename 采用时不启动资源；`setup` 时点到达后，即使它抛错也会尝试 `teardown`。

`setup` 失败会让本 Run 中受影响的计划成员形成可审计的执行失败事实。
它不会改写其它 Experiment 的 Run，也不会把错误伪装成已采用的 Attempt。

`teardown` 的失败产生 Run 范围 Diagnostic 或 Claim，并不重写已经形成的 Verdict。
无法拦截的强杀只能让 `InvocationReceipt.completion` 落为 `incomplete` 或 `interrupted`，并可能让其 `record.state` 落为 `partial` 或 `not-recorded`；它不能给 Run 或 Graph root 添加 `sealed` 状态。

## 强杀后的收尾回退：收尾登记与启动自愈

宿主侧回退登记是外部协调状态，不是 Record entity，也不属于 Run 的事实图。
它只保存完成 Hook 所需的最小身份和活跃信息，允许后续 Invocation 发现孤立的收尾义务。

- Runner 在启动 Experiment Hook 前登记义务，在该 Hook settle 后以原子方式解除自己的义务。
- 新 Invocation 发现本机已失活的义务时，只在当前仍选中同一 Experiment 且存在 `teardown` 时补执行。
- 竞争者以原子领取义务；同一义务不会被两个进程同时补执行。
- 补执行只产生新的 Run 范围 Observation、Diagnostic 或 receipt 信息。它不修改历史 Attempt、Contribution 或 GraphRef。

补执行没有原进程的模块闭包。
需要跨进程拆除的资源必须由 `teardown` 自己的持久化坐标或外部控制面发现，不能假设 `setup` 的内存变量仍在。

`niceeval exp <selector> --teardown` 只运行这条补偿路径。
它不建立 Attempt、RunContribution 或新的评测结果；失败会明确报告，且不会把未完成的义务伪装成成功。

## 并发 Invocation：用例锁与共享状态租约

多个 Invocation 可以写入同一 RecordStore。
Store 的 CAS 让每个提交线性化；调度仍需防止两个进程同时执行同一个 `(experimentId, evalId)`，并保护共享外部状态。

用例锁的逻辑键是 `(experimentId, evalId)`。
持有者承接该 Eval 本次所需的所有 Attempt ordinal，而不是把同一通过率分母拆给不同 Invocation。
锁只保护调度，不拥有 Record 数据。

- 取锁发生在派发前。等待者不占 Attempt 并发位，并在 Live reducer 中计为 `elsewhere`。
- 取得锁后，Runner 打开一个明确的已提交 `RecordGraphRef`，重新按 [携带判据](cache.md#携带要过的门)计划该 Eval。
- 可采用的成员形成 `carried` Contribution；仍缺的成员才执行。这个过程不扫描或拼接目录。
- 心跳过期可被一个竞争者原子接管。接管只写入 Diagnostic，不让两个执行者同时取得锁。
- 释放发生在持有者的 Attempt 收尾后。强杀留下的锁由过期规则处理，而不是由猜测的文件时间处理。

`sharedState.key` 是跨 Invocation 的外部状态事务身份。
它的租约从 Experiment `setup` 和 Sandbox lifecycle `setup()` 之前开始，直到 lifecycle `teardown()`、Provider finalizer 与 Experiment `teardown` 都结束。
等待租约的一方不创建 Sandbox，也不先取得 Eval 用例锁。

`sharedState` 只提供互斥。
作者仍必须把外部 checkpoint 的提交与 Attempt 终态设计为可恢复边界；强杀后的接管不能证明半次外部写入可以继续使用。

全局与 Experiment 级并发限制都是单个 Invocation 的吞吐控制。
它们不替代用例锁或状态租约，也不会跨进程取最小值。

## Invocation 索引与 Session 查询

运行中的查询可保留 `niceeval session` 命令名，但它只读取以 `invocationId` 为键的外部 Invocation 索引。
这个索引由与 Live 相同的 Reducer 产生，能列出关联的 Run、状态与计数。

它不建立第二个 Session identity，不公开内部索引的物理路径，也不进入 Record entity catalog。
它更不能把 Run 表述成可替换的读取面。

索引在 Invocation 完成后保留的终态信息只是一份 reducer 状态与 receipt 指针。
完整事实仍通过 receipt 的 `RecordGraphRef` 打开 Record；`show`、Sample 与 Report 不从 Invocation 索引拼接结果。

## Carry：自动携带

规划找到终态 Attempt，且其指纹与执行资格仍可采信时，Runner 不重新执行它。
目标 Experiment 新建 Run，并创建说明选择依据的 carry Claim 与 `mode: "carried"` Contribution。

该 Contribution 采用原 Attempt 的明确 revision。
Attempt 的 `originRunId`、locator、Verdict、Observation、evidence 与 Provenance 都保持原样；目标 Run 只取得自己的 membership slot、Contribution 与 Claim。

每次 `RunContribution` 更新都保留同一 `contributionId`、`mode` 与 `attemptId`。
迟到事实只能让 adopted node 前进到同一 Attempt 的已验证后继 revision。

Sample 只在明确的 `RecordGraphRef` 中读取 Run 的 current Contribution strong edge。
它不按时间、可变 head 或未声明的默认规则暗选成员，也不会把多个 Invocation 的事实拼成未声明的总体。

## Invocation Completion 与退出

Invocation 建立后，Runner 始终返回 [InvocationReceipt](../record/architecture.md#receipt-与部分持久化)。
它包含 `invocationId`、每个 Run 的 completion、每个 Attempt 的 receipt、terminal Live 状态与本次可验证的 `RecordCommit`。

`complete` 只在 required streams、终态实体、Claim、Contribution 与列出关系都可从 receipt 的 GraphRef 验证时成立。
预算耗尽、停止派发、Record 写入失败或中断会以 `incomplete` 或 `interrupted` 表达；不能用绿色 Verdict 或空数组掩盖。

`not-recorded` 没有 GraphRef。
`partial` 必须保留最后 durable GraphRef、`durableThrough` 与写入失败；`complete` 才允许后续读取把该 receipt scope 当成完整。

退出状态同时考虑 terminal Live 的 Verdict 计数、Invocation completion 与 RecordCommit。
这条规则的 CLI 反馈见 [CLI](cli.md)，Record 形状与完整性判据见 [Record](../record/README.md)。

## 相关阅读

- [README](README.md) —— `defineExperiment` 的公开配置。
- [Library](library.md) —— 配置透传、Hook 与反馈入口。
- [缓存与携带](cache.md) —— 指纹、carry 与 accept 的资格。
- [实验改名](rename.md) —— 用 `renamed` Contribution 表达 Experiment 身份变化。
- [CLI](cli.md) —— Invocation、accept、Session 查询与机器输出。
- [Record](../record/README.md) —— Graph、Attempt、Contribution、Claim、Live 与 receipt 的唯一 owner。
