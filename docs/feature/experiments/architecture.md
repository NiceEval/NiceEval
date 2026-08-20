# Experiments 架构

Experiment 是可签入的运行配置。它选择 Eval、声明 Agent 和调度条件；[Record](../record/README.md) 保存 Run membership 与 Attempt 业务事实。

## 实体关系

```text
Invocation
  └─ Run（Core）：一个已求值的 Experiment
      ├─ expected slot（Core）
      │   └─ Member：slot → exact Attempt
      │       ├─ relation：origin | reference（由关系推导）
      │       ├─ action：executed / carried / accepted / not-dispatched / interrupted
      │       └─ Attempt（Core outcome）
      ├─ Attempt 固定事实：Assertions、Observability、FileChanges、SourceNavigation、Artifacts
      └─ Run 固定事实：Observability、Sources、Artifacts
```

Runner 在调用开始时取得 `invocationId`，并为每个选中的 Experiment 分配尚未发布的
`ExecutionTarget` Run、`runId`、`startedAt` 与完整 expected slots。它用 `RecordReadSession` 做 weak scan
（弱扫描），只把已经有 `complete` 的 Run 交给 reuse planning。扫描不是 Invocation 级的 frozen view
（冻结视图）：并发封口的 Run 可以整体进入或整体不进入某次计划。

每个 `RunWriteSession`（Run 写入会话）只排他创建并写入自己的 `runs/<RunId>/`。目标 Run 在规划完成前
没有 `complete`，不会成为自己的 source barrier。不存在全局 Record writer lock（写入锁）。

Invocation receipt 以 `runIds` 关联本次调用，但不是可扩展的 Record 事实面。Run/Member/Attempt 的身份、分母、action、reference 与 outcome 由 Core 唯一保存。Assertions、Observability、FileChanges、SourceNavigation、Sources 与 Artifacts 按 Record catalog 的 owner 各自保存固定事实。`points` 只在 Assertion 的 score facts 中出现，Report 只能从这些既有事实投影，不能另存 evaluation 或 verdict 家族。

Run 的 expected membership 是本次分母。每个 slot 最多有一个 Member；任何 Member 都无条件表示该 slot 由一个精确 Attempt 完整占据。Member 不保存会持续扩张的业务 kind。

Attempt 的 `origin.runId` 永远指向实际执行它的 Run。当当前 Member 的 `(runId, slotId)` 与 Attempt.origin 完全相等时，relation 派生为 `origin`；否则为 `reference`。reference 只保存同一 Record 内的稳定 `{ originRunId, attemptId }`，不复制 Verdict、Usage、events 或 artifact。

源 Attempt 随 origin Run 发布后 immutable。后续读取 reference 时沿精确引用取得同一份事实；外部损坏造成引用失效时产生 dangling issue。自动沿用与显式采用分别由 Core Member 的 `carried` / `accepted` action 和 reference 表达；第三方不能在这条链上取得 durable writer、增加 family 或提供 migration。

## 配置求值

配置优先级是 CLI flag → Experiment 字段 → Eval 字段 → `niceeval.config.ts` → 默认值。凭据变量与宿主条件不参加这条链。

| 字段 | 求值链 | 默认 |
|---|---|---|
| `timeoutMs` | `--timeout` → Experiment → Eval → config | 无上限 |
| `judge` | 单条断言 → Experiment → Eval → config | 需要 Judge 时报告缺少配置 |

`judge` 按字段合并。Experiment 只能配置 Judge 的执行条件；rubric、评分材料、Severity 与 threshold 仍由 Eval 的 assertion 定义。

`apiKeyEnv` 只声明凭据位置，不进入可比性身份，也不写入 Record。所有消费者使用同一份已求值配置；调度、fingerprint、Core execution identity 与反馈不能各算一份。

## Coordination（协调）与 Run 级共享准备

Coordination 拥有 execution deduplication（执行去重）、同一 Experiment 的 dispatch claim（派发占用）、
本 Invocation 的 `maxConcurrency`，以及 build / lease（构建 / 租约）。它的可变状态在 `.niceeval/`
的 Record 外；这些机制不能从 Run directory 推断，也不作为 durable Record fact。

Record 只拥有每个 Run 的目录、Core、fixed family closure 与 `complete` 发布点。多个 Invocation 可以向
同一 root 追加不同 Run；读取面只读取已发布 Run。

Eval 需要按需构建 Sandbox 时，BuildKey 构建、共享拉取与发布属于 Run 级活动，不属于任一 Attempt。

- 共享准备有独立并发、逐 key timeout、总准备上限与 Invocation abort。
- Attempt deadline 从取得构建输出并开始创建 Sandbox 时计算。
- 共享准备的时长和失败进入 Run diagnostics 与 timing。

完整规则由 [Sandbox · Run 级构建协调](../sandbox/case.md#run-级构建协调共享准备的预算与调度) 定义。

## Experiment 生命周期

`setup(ctx)` 与 `teardown(ctx)` 在宿主机执行，每个 Run 最多各一次。它们负责该 Experiment 的共享资源；Sandbox 内准备仍归 Eval 或 Experiment layer。

固定顺序如下：

1. Runner 确认至少有一个 Attempt 需要执行。
2. 执行 Experiment `setup`。
3. 建立 Sandbox、准备任务输入并执行 Attempt。
4. 所有 Attempt 和 Sandbox 收尾后执行 Experiment `teardown`。

只要 `setup` 的调用时点已经到达，`teardown` 就必须尝试一次。`setup` 抛错时不派发 Attempt，但仍执行 `teardown`。

Hook 通过 `ExperimentHookContext` 上报 Run 范围的 progress 与 diagnostic，并以闭包管理运行时资源。它没有通用 durable writer；运行时观测只有经 NiceEval 已发布的 typed collector 或 Adapter 能力进入 Record catalog 中具名且 owner 固定的 family。它不能创建 Attempt Verdict，也不能把错误 diagnostic 当成失败判定。

## 强杀后的收尾

Runner 在触发 `setup` 前，把 teardown 所需的稳定输入写入 `.niceeval/teardowns/`。该目录由 Runner lifecycle owner 管理，不属于 Record。

正常退出时，Runner 执行 teardown 并删除对应登记。进程被强杀后，下一次启动先检查本 Experiment 的登记；确认原宿主进程已结束后，补执行一次 teardown，再进入新的 setup。若该 Experiment 声明 `sharedState.key`，启动自愈必须先取得该 key 的当前 exact authority，才可读取、删除或执行旧登记。active 或 recovering generation 只会让它等待，绝不自动接管、执行旧 teardown 或替换该 generation。

这项启动义务独立于 `ExperimentLifecycleCell`：即使本次所有结果都 carry、没有任何 Attempt，selected Experiment 也必须等到旧登记已在同 key authority 下完成，或等操作员显式恢复；它不会借零 Attempt 跳过安全边界。

`niceeval exp <selector> --teardown` 只运行这条补偿路径。它不建立 Run、Member 或 Attempt。

## 并发 Invocation

同一 Record root 支持多个写 Invocation 并发追加。它们各自只写唯一 `RunId` directory，互不读取对方
尚未发布的目录，也不共享 Invocation 级事务。每个 Run 的 `complete` 才是独立发布点。

`show`、`view`、`exp --dry` 与普通 reader 使用 shared read lease（共享读取租约）。它们只按需读取已发布
Run；weak scan 不保证同一时刻的全局快照。并发创建 `complete` 的 Run 可以整体被某次扫描看到，也可以留给
下次扫描。

`clean` 与 `migrate` 属于 maintenance（维护）。它们取得 exclusive maintenance lease（排他维护租约），
因此仍与 reader、append writer 和其它 maintenance 操作互斥。冲突返回 `record-maintenance-busy`。

`sharedState.key` 保护跨 Invocation 的外部可变状态。其持有期从 Experiment setup 和 Sandbox setup 之前开始。
最后一个 Attempt settle 后，同一 Experiment 的 reusable pool registry 先冻结，不能再创建 pool。

等待 sharedState 的协调 fiber 不占有有限的 dispatch execution worker 或 Provider lane；Experiment gate、global 并发位和 Provider lane 仍约束实际 Sandbox / Agent body 的物理并发。因此同 key waiter 不会饿死当前 holder 的后继 Attempt。

全部 pool 的 single-flight stop 完成 Sandbox teardown 与 Provider finalizer，之后才执行 Experiment teardown。只有所有实际
cleanup 成功才释放 sharedState lease。setup 失败仍要等待停稳并执行后续 cleanup；不会仅因 setup 失败留下 lease。

若任何实际 cleanup、finalizer 或 teardown 失败、超时或中断，Runner 继续尝试余下收尾。lease 留给公开显式恢复，退出
sweep 不得删除。

sharedState authority 是 owner-token-checked 的不可变 generation transition：active、recovering 与 free 都只能从
精确前代发布下一代，旧 owner 无法删除或替换新 owner。

正常 contention 只发不含 token 的 `state-lease-waiting` info，且不写入 Run diagnostic。cleanup-required warning 只持久化 key 与原因；owner token 只在显式 public inspection 的人读输出中显示。

公开 explicit recovery 把输入 `sharedState.key` 当作恢复 authority。CLI 先从该 key 的 immutable generation 读取 owner evidence。

作者后来改名或删除当前 `sharedState` 声明时，旧 key 仍保留公开 inspection 与恢复入口。

随后 CLI 要求 selector 唯一，且它的 Experiment id 必须等于 immutable evidence 的 id。当前 target 的 `teardown` 必须是函数。
selector 不唯一、Experiment 不匹配或 teardown 缺失/非函数时，CLI 不进入 recovery transition，当前 active generation 保持原样。

recovery claim 后只核对由 immutable `{ experimentId, host, pid, processIdentity }` 绑定的那一条旧 teardown 登记。它绝不按
当前声明扫描或删除同 Experiment 的其它登记。

local recovery 对 PID 复用、缺失和 Linux `Z`/`X`/`x` 终态采用与 lease 相同的 identity 判定。identity 或预期登记的读取、格式
检查失败都 fail closed。

teardown 成功后，CLI 必须先原子删除这条精确登记，再发布 free generation。删除、重核或发布失败都 fail closed，recovering
generation 保持可 inspection、可重试；waiter 只能在旧 teardown 义务已经消失后进入。

若精确 token 已处于 free，CLI 不重跑 teardown，但仍仅能幂等清除可证明属于该 immutable owner 的遗留登记。不能证明或不能
清除时非零退出。

heartbeat 是按 exact owner token + generation 写入、原子替换的独立诊断 sidecar。公开读取只在这两个值仍匹配当前
immutable head 时采用它的时间显示。sidecar 写/读失败不改变 authority，旧 owner 的 sidecar 也不能影响新 generation。
heartbeat 不会过期、接管或复活持有者；PID/heartbeat 也从不是自动接管依据。

链只接受 `free → active`、`active/recovering → recovering` 与 `active/recovering → free`。连续 recovery 必须保留原始
owner evidence，并更换 recovery id 与 actor。free 的 `previous` 必须与真实前代完整相等；其它相邻状态一律 fail closed。

v2 legacy 仅可作为 generation 1 的 exact-owner recovering 迁移前代。

`sharedState.key` 只协调外部可变状态，不提供 Record revision 或写事务。whole-root copy、Git checkout 或外部修改前必须停止相关 Invocation 和 reader；已经释放 reader 的 Report execute 或站点写入不访问该 root。

## Reuse planning 与 carry

具名 reuse planning（`project-target/v1`）接收当前 ProjectTarget、尚未发布的 ExecutionTarget、
`RecordReadSession` 的 weak published-Run selection（已发布 Run 弱选择）和本次 policy。它按
[Reuse planning](cache.md#project-targetv1-的-source-barrier) 选择 source barrier，并把每个目标 slot
穷尽判定为 `reuse | gap`。

invocation coordinator 持有完整的 `ExecutionReusePlan`。planner/scheduler 只接收 gap 子序列，不能访问
Record 或重做资格判断。writer 最后接收 target、reuse intents 和 executed outcomes：reuse 与已执行 gap
都写相同的 Member 形状；前者成为 reference，后者连同新 Attempt 成为 origin。

reference Member 的永久 Core 保存：

- 当前 Run 与 slot identity；
- 被采用的 `{ originRunId, attemptId }`；
- `carried` 或 `accepted` action。

正常停止派发且从未 reserved 的 slot 以 Core `not-dispatched` action 封口；有执行 outcome 的 slot 是 Core
origin Member。SIGINT 把仍在飞的 reserved Attempt 封为 `interrupted` origin，并把未 reserved slot 封为
`interrupted` Member。正常收尾不允许遗留无 outcome 的 reserved / pending Attempt，具体见
[Invocation receipt 与退出](#invocation-receipt-与退出)。

writer seal 验证这些 Core action、reference 与 expected membership 的关系。任何 read-side comparison、
policy identity 或 operator note 都只是当前操作的瞬时说明，不能形成第六类持久事实。

新的 reuse planning 必须从 Core combined execution identity、Attempt outcome，以及固定 Assertions 和 Observability 重新校验，不能只信历史 action。

## Invocation receipt 与退出

Runner 始终返回 Invocation receipt。它只包含：

```ts
interface InvocationReceipt {
  readonly invocationId: string;
  readonly runIds: readonly string[];
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly completion: "completed" | "interrupted" | "failed";
}
```

receipt 不复制 locator、Verdict、Usage、cost、Attempt 计数或 Report 聚合。需要这些结果时，以 `runIds` 打开 Record，并用 `explicit-runs` analysis selection 创建 `Sample`。

进程退出码由本次 Runner 已知的 Verdict、执行错误和 Invocation completion 计算。receipt 只描述调用完成情况，不成为另一份结果摘要。

`runIds` 只列出已经创建 `complete` 的 Run。它不表示一次 Invocation 的整体提交，也不会列出没有发布的
directory。

收到 `SIGINT` 时，Runner 停止新的派发并关闭当前 Run。已经完成的 Attempt 保留原 outcome 与固定事实；仍在飞的 reserved Attempt 以 `interrupted` outcome 关闭，未 reserved slot 写作 `interrupted` Member。Run 完成普通 seal 后进入 `completion: "interrupted"` receipt，使中断前完成的 Attempt 可以按 locator 读取。写入或 seal 失败的 Run 不在 receipt 中，并保留为 incomplete directory。

正常、非中断的收尾若发现没有 execution outcome 的 reserved / pending Attempt（已预留 / 待结算 Attempt），必须严格失败。它不能把
这些状态改写成已关闭 Member，也不能发布该 Run；已经独立发布的其它 Run 保持可读。

## 相关阅读

- [README](README.md) —— `defineExperiment` 的公开配置。
- [Library](library.md) —— 配置透传、Hook 与反馈入口。
- [缓存与携带](cache.md) —— fingerprint、carry 与 accept 资格。
- [实验改名](rename.md) —— 以 Core reference Member + `accepted` action 表达 Experiment 身份变化。
- [CLI](cli.md) —— Invocation、accept、查询与机器输出。
- [Record](../record/README.md) —— Run、Member、Attempt 与 receipt 的 owner。
