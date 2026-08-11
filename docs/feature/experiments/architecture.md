# Experiments 架构

Experiment 是可签入的运行配置。它选择 Eval、声明 Agent 和调度条件；[Record](../record/README.md) 保存 Run membership 与 Attempt 业务事实。

## 实体关系

```text
Invocation
  └─ Run：一个已求值的 Experiment
      ├─ expected slot
      │   └─ Member：executed | carried | accepted
      │       └─ Attempt
      └─ Run diagnostics
```

Runner 在调用开始时取得 `invocationId`，再打开单 writer `RecordWriteSession`。它在 session 内为每个选中的 Experiment 形成尚未发布的 `ExecutionTarget` Run，绑定 `runId`、`startedAt` 与完整 expected slots。execution projector 使用 frozen `session.view`；完整 Run seal 后才原子发布，目标不能参与自己的历史投影。

可选的 Run-owned `niceeval.run-provenance` 可以保存 invocation identity，receipt 也以 `runIds` 关联本次调用；这些 provenance 不参与 membership 或任何 analysis/execution projector。

Run 的 expected membership 是本次分母。每个 slot 最多有一个 Member：

- `executed` 表示本 Run 实际创建了该 Attempt；
- `carried` 表示 project-target execution projector 当时采用已有 Attempt；
- `accepted` 表示操作者明确采用已有 Attempt。

Attempt 的 `origin.runId` 永远指向实际执行它的 Run。carried 与 accepted Member 只保存同一 Record 内的稳定引用，不复制 Verdict、Usage、events 或 artifact。

源 Attempt 随 origin Run 发布后 immutable。后续读取 carried 或 accepted Member 时沿 `{ originRunId, attemptId }` 取得同一份事实；外部损坏造成引用失效时产生 dangling issue。

## 配置求值

配置优先级是 CLI flag → Experiment 字段 → Eval 字段 → `niceeval.config.ts` → 默认值。凭据变量与宿主条件不参加这条链。

| 字段 | 求值链 | 默认 |
|---|---|---|
| `timeoutMs` | `--timeout` → Experiment → Eval → config | 无上限 |
| `judge` | 单条断言 → Experiment → Eval → config | 需要 Judge 时报告缺少配置 |

`judge` 按字段合并。Experiment 只能配置 Judge 的执行条件；rubric、评分材料、Severity 与 threshold 仍由 Eval 的 assertion 定义。

`apiKeyEnv` 只声明凭据位置，不进入可比性身份，也不写入 Record。所有消费者使用同一份已求值配置；调度、fingerprint、Run provenance 与反馈不能各算一份。

## Run 级共享准备

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

Hook 通过 `ExperimentHookContext` 上报 Run 范围的 progress、fact 与 diagnostic。它不能创建 Attempt Verdict，也不能把错误 diagnostic 当成失败判定。

## 强杀后的收尾

Runner 在触发 `setup` 前，把 teardown 所需的稳定输入写入 `.niceeval/teardowns/`。该目录由 Runner lifecycle owner 管理，不属于 Record。

正常退出时，Runner 执行 teardown 并删除对应登记。进程被强杀后，下一次启动先检查本 Experiment 的登记；确认原宿主进程已结束后，补执行一次 teardown，再进入新的 setup。

`niceeval exp <selector> --teardown` 只运行这条补偿路径。它不建立 Run、Member 或 Attempt。

## 并发 Invocation

同一 Record root 不支持并发写 Invocation。Runner 在 execution projection 前取得 `RecordWriteSession`，并一直持有 writer lock 到 Invocation 的全部 Run 收尾。无法取得时以 `record-writer-busy` 失败，不等待、不接管，也不读取另一个 writer 的 local session。

多个写 Invocation 只有在使用不同 Record root 时才可并发。lock-free reader、`show`、`view`、`exp --dry` 与静态 export 的 Record build 阶段可以和 writer 并发；它们只看已经发布的完整 Run，weak scan 不保证看见本 Invocation 的全部 Run。

`sharedState.key` 保护跨 Invocation 的外部可变状态。其持有期从 Experiment setup 和 Sandbox setup 之前开始，到所有 teardown 与 finalizer 结束。

`sharedState.key` 只协调外部可变状态，不提供 Record revision 或写事务。whole-root copy、Git checkout 或外部修改前必须停止相关 Invocation 和 reader；已经释放 reader 的 Report execute 或站点写入不访问该 root。

## Execution projection 与 carry

具名 `project-target/v1` execution projector 接收当前 ProjectTarget、尚未发布的 ExecutionTarget、`RecordWriteSession.view` 和本次 policy。它按 [Execution projection](cache.md#project-targetv1-的-source-barrier) 选择 source barrier，并把每个目标 slot 穷尽投影为 `reuse | gap`。

invocation coordinator 持有完整 projection。planner/scheduler 只接收 gap 子序列，不能访问 Record 或重做资格判断。writer 最后接收 target、reuse intents 和 executed outcomes：reuse 固定写 carried，已执行 gap 固定写 executed；没有 outcome 的 gap 不写 Member。

carried Member 的永久核心只保存：

- 当前 Run 与 slot identity；
- 被采用的 `{ originRunId, attemptId }`；
- `kind: "carried"`。

`niceeval.actions` 为每个 target slot 保存当时的 policy identity、effective options、comparison provenance、reuse/gap 决定和最终 outcome。reuse 以 `slotId`、`attemptId` 关联；没有 outcome 的 gap 仍保存 `not-dispatched` 或 `interrupted` action，但没有 Member。

这些事实解释当时为何采用或执行，不持续认证源 Attempt。新的 execution projector 必须按公开 policy 重新校验 eligibility schema 与 `reuseContract`，不能只信历史 policy identity。

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

receipt 不复制 locator、Verdict、Usage、cost、Attempt 计数或 Report 聚合。需要这些结果时，以 `runIds` 打开 Record，并用 `explicit-runs/v1` analysis projector 创建 `AnalysisSample`。

进程退出码由本次 Runner 已知的 Verdict、执行错误和 Invocation completion 计算。receipt 只描述调用完成情况，不成为另一份结果摘要。

## 相关阅读

- [README](README.md) —— `defineExperiment` 的公开配置。
- [Library](library.md) —— 配置透传、Hook 与反馈入口。
- [缓存与携带](cache.md) —— fingerprint、carry 与 accept 资格。
- [实验改名](rename.md) —— 以 accepted Member 表达 Experiment 身份变化。
- [CLI](cli.md) —— Invocation、accept、查询与机器输出。
- [Record](../record/README.md) —— Run、Member、Attempt 与 receipt 的 owner。
