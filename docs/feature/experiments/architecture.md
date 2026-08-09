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

Runner 在调用开始时取得 `invocationId`。每个选中的 Experiment 恰好建立一个 Run；Run 核心保存 `experimentId`。可选的 Run-owned `niceeval.run-provenance` 可以保存 invocation 与 startedAt，receipt 也以 `runIds` 关联本次调用；这些 provenance 不参与 membership 或 latest。

Run 的 expected membership 是本次分母。每个 slot 最多有一个 Member：

- `executed` 表示本 Run 实际创建了该 Attempt；
- `carried` 表示规划器自动采用已有 Attempt；
- `accepted` 表示操作者明确采用已有 Attempt。

Attempt 的 `originRunId` 永远指向实际执行它的 Run。carried 与 accepted Member 只保存同一 Record 内的稳定引用，不复制 Verdict、Usage、events 或 artifact。

源 Attempt 的业务数据允许在 Record 停稳时编辑。后续读取 carried 或 accepted Member 时会看到编辑后的当前值；引用失效时产生 dangling issue。

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

同一 Record root 不支持并发 Invocation。Runner 在规划前确认该 root 没有 active reader、writer 或人工编辑，随后独占它直到 Invocation 收尾；无法独占时以 <code>record-root-busy</code> 失败，不等待、不接管，也不重读运行中状态。静态 export 的 Record 读取/build 阶段表现为 active reader；释放后执行与写站阶段不占 root lease。

多个 Invocation 只有在使用不同 Record root 时才可并发。它们不能在完成后自动合并；需要同一分析范围时，调用方应在停稳的一个 Record 中重新运行或显式选择既有 Run。

`sharedState.key` 保护跨 Invocation 的外部可变状态。其持有期从 Experiment setup 和 Sandbox setup 之前开始，到所有 teardown 与 finalizer 结束。

<code>sharedState.key</code> 只协调外部可变状态，不提供 Record revision 或编辑事务。人工编辑 Record 时必须先停止相关 Invocation 和 active reader；已经释放 reader 的 Report execute 或站点写入不访问该 root。

## Carry

规划器找到终态 Attempt，且 fingerprint、timeout 和 `--rerun` 资格都满足时，不重新执行它。目标 Run 为该 slot 写入 carried Member。

carried Member 的永久核心只保存：

- 当前 Run 与 slot identity；
- 被采用的 `attemptId`；
- `kind: "carried"`。

建立 Member 时的 input/config identity、资格与理由进入 Run 的 `niceeval.actions` 通道，以 `slotId`、`attemptId` 关联。这些事实解释当时为何采用，不持续认证源 Attempt。源 Attempt 后续被编辑时，Member 仍读取它的当前业务值。

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

receipt 不复制 locator、Verdict、Usage、cost、Attempt 计数或 Report 聚合。需要这些结果时，以 `runIds` 打开 Record 并创建 Sample。

进程退出码由本次 Runner 已知的 Verdict、执行错误和 Invocation completion 计算。receipt 只描述调用完成情况，不成为另一份结果摘要。

## 相关阅读

- [README](README.md) —— `defineExperiment` 的公开配置。
- [Library](library.md) —— 配置透传、Hook 与反馈入口。
- [缓存与携带](cache.md) —— fingerprint、carry 与 accept 资格。
- [实验改名](rename.md) —— 以 accepted Member 表达 Experiment 身份变化。
- [CLI](cli.md) —— Invocation、accept、查询与机器输出。
- [Record](../record/README.md) —— Run、Member、Attempt 与 receipt 的 owner。
