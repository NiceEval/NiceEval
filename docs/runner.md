# Runner —— 执行引擎

Runner 把已求值的 Experiment 变成完整发布的 Record Run。它负责调度、Sandbox 生命周期、Attempt 收尾和 `EvaluationRecordContract`；Record 负责目录协议，Sample 负责选择，Reports 负责计算与呈现。

## 职责边界

Experiment 配置先进入 Runner。Runner 建立 Run 与 expected slots，执行或采用 Attempt，并写入 owner-local RecordAttachment。

随后 analysis selection 从 frozen reader 形成 `AnalysisSampleHandle`；宿主按 Report 声明闭合数据依赖，形成一次 immutable `ReportExecution`。Reports runtime 只消费 `ReportExecution`。

Runner 不为页面准备聚合结果，不向 receipt 复制 Verdict、locator、用量、费用或计数。页面和脚本按 receipt 的 `runIds` 重新打开 reader。

## Run、Member 与 Attempt

每个选中的 Experiment 对应一个 Run。Run 的 expected slots 决定本次分母；每个 slot 最多对应一个 Member。

| Core relationship | Runner 行为 |
|---|---|
| `origin` | 本 Run 实际执行 Attempt，并建立唯一 origin Member。 |
| `reference` | 当前 slot 精确引用已发布 Attempt，不复制 payload。 |

Attempt 的 origin 永远是实际执行它的 Run。reference Member 不复制 AssertionResult、grading、usage、conversation、diff 或 artifact。

Run 的 `niceeval.membership-provenance` RecordAttachment 保存 reuse、adoption 或 rename 的上下文和理由，并以 `slotId`、`attemptId` 关联。

## 运行顺序

1. Runner 取得 shared maintenance lease，再取得指定 root 的 writer lock。另一个 writer 以 `record-writer-busy` 失败，reader 可并发。
2. `RecordWriteSession.view` 冻结既有 Run。Runner 先形成带 `startedAt` 与完整 expected SlotId 的目标 Run draft，reuse planning 再按 `(startedAt, runId)` 为每个 Experiment/Eval 选唯一 carry source，把每个 Slot 穷尽判为 reuse 或 gap。
3. 执行时，Runner 取得 Sandbox，驱动 Agent，登记 Assertion，并形成 AssertionResult 与对应评估类型的 grading。
4. `EvaluationRecordContract` 验证 Assertions、grading、evaluations、provenance 与 required RecordAttachment。
5. generic writer 在 local session 形成 Core、RecordAttachment closures 与 blobs，flush 后最后创建零字节 `complete` 完成标识。
6. Runner 返回 Invocation receipt，并释放 writer lock 与 maintenance lease。

已发布 Run immutable。Runner 不提供局部编辑、删除、版本校验或 Invocation 级事务；运行中的状态只存在于当前进程和 local session。

## Invocation receipt

~~~ts
interface InvocationReceipt {
  readonly invocationId: string;
  readonly runIds: readonly string[];
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly completion: "completed" | "interrupted" | "failed";
}
~~~

receipt 只标识这次调用及其 Run。它不是第二份结果文件，也不带页面需要的业务数据。终端反馈与 `--json` 的 progress 同样只属于当前进程。

## 调度

Runner 先展开 expected slots，再以全局和 Experiment 范围的并发限制派发。等待并发名额的 slot 没有 Attempt，也不会占用执行资源。同一 root 不存在跨 Invocation 的逐 Eval 锁或运行中重读。

首过即停、预算耗尽、用户中断和已声明的停止派发条件都保留 expected slot。未派发 slot 没有 Member，因此 Sample 把它显示为 `not-recorded`；Runner 不制造虚构的 Attempt 或 Verdict。

运行中发生的短状态、计数和进度只显示给当前进程。Run 或 Attempt 范围的诊断、阶段、计时、用量与其它业务事实写入相应 RecordAttachment。

## Carry 与 accept

carry 只在 Verdict 与 eligibility 都 read、精确 payload 合法时发生。`reuseContract` schema/domain/token 必须先满足当前 policy，随后才比较 identity、duration 与其它 gates。partial、缺失、损坏、不支持或 domain 不同都选择执行并提供具名原因；持久判定输入的穷尽清单只由 [reuse planning](feature/experiments/cache.md#复用资格) 定义。

`niceeval accept` 先校验全部 locator，再建立含 reference Member 的 Run，并在 membership provenance 中写出 adoption。任一 locator 无效时不写入该批次。

资格和操作者理由进入 Run-owned RecordAttachment；源 Attempt 已随 origin Run 冻结。

详细规则见 [缓存与携带](feature/experiments/cache.md)。

## 证据与 RecordAttachment

Runner 在采集前读取 Assertion 对 RecordAttachment 的需求。

- 参与 grading 的 Assertion 所需材料无法交付时，该 Assertion 为 `unavailable`，Pass 或 Score projection 按契约处理。
- 不参与 grading 的 Assertion 仍保留 `unavailable`，但不会单独作废正式 grading。
- 只供报告使用的 RecordAttachment 失败时，Runner 写入具名诊断，已形成的业务数据保持原值。

RecordAttachment 的采集完整度（`collection`）与读取状态由 Record reader 分开表达。Runner 不把未采集、未知 schema 或损坏文件写成空值。

## 生命周期与收尾

Experiment `setup` 与 `teardown` 在宿主机运行，每个 Run 最多各一次。只要进入 setup 的调用点，Runner 就尝试 teardown。Sandbox、Agent runtime、作者 cleanup 和 Provider finalizer 各自按所属生命周期收尾。

Run 范围的 setup、teardown、共享准备和停止派发信息写入 Run 的诊断或计时 RecordAttachment。它们不冒充某个 Attempt 的数据。

超时停止继续执行，但会保留在停止前已经交付的 RecordAttachment 数据。Runner 将 timeout 诊断写入 Attempt-owned RecordAttachment，并让 Assertion 与 Verdict 的正常规则决定最终状态。

## 相关阅读

- [Experiments 架构](feature/experiments/architecture.md)
- [Experiments CLI](feature/experiments/cli.md)
- [Record 架构](feature/record/architecture.md)
- [Assertions 证据](feature/assertions/architecture/evidence.md)
- [Verdict](feature/verdict/architecture.md)
- [执行失败分类](feature/error-classification/architecture.md)
