# Runner —— 执行引擎

Runner 是 `experimentHost` 后的内部执行引擎。它把已求值的 Experiment 变成完整发布的 Record
Run，负责调度、Sandbox 生命周期与 Attempt 收尾；它通过 `recordHost` 持久化，不能被 CLI 或
Report 直接调用。Record 负责持久事实，Analysis 负责选择和闭合结果，Report 负责计算与呈现。

## 职责边界

Experiment 配置先进入 `experimentHost`。Host 将计划交给 Runner；Runner 建立 Run 与 expected
slots，执行或采用 Attempt，并通过 `recordHost` 封口 Core 与固定 family 事实。

查看时，Report Host 在其内部经 `recordHost.openRead()` 取得 reader，再由 `analysisHost.openSample()`
签发 Sample。Page 与组件只通过 `aggregate()` / `query()` 取得 `ClosedRows`、`SemanticFrame` 或
`DomainView`。`show` 只关闭选中的 Page；view 与静态导出才关闭全部 Page 并形成 `ClosedSiteRevision`。
交付后的文本、JSON 或站点 bytes 都不再持有 reader。

Runner 不为页面准备聚合结果，不向 receipt 复制 Verdict、locator、用量、费用或计数。页面和机器调用方按 receipt 的 `runIds` 通过 `show` / `view` 读取结果。

## Run、Member 与 Attempt

每个选中的 Experiment 对应一个 Run。Run 的 expected slots 决定本次分母；每个 slot 最多对应一个 Member。

| Core relationship | Runner 行为 |
|---|---|
| `origin` | 本 Run 实际执行 Attempt，并建立唯一 origin Member。 |
| `reference` | 当前 slot 精确引用已发布 Attempt，不复制 payload。 |

Attempt 的 origin 永远是实际执行它的 Run。reference Member 不复制 AssertionResult、grading、usage、conversation、diff 或 artifact。

Run Core 的 Member action 保存 reuse、adoption 或 rename 的上下文和理由，并以 `slotId`、`attemptId`
关联。它不是一份额外的 provenance family。

## 运行顺序

1. `experimentHost` 进入 Runner。Runner 为每个目标 Run 分配 `RunId`、`startedAt` 和完整 expected
   SlotIdentity；每个 Slot 将当前 zero-based attempt number 直接写入 durable `attemptOrdinal`，不从顺序推断。
2. Record Host 对已发布 Run 做 weak scan（弱扫描）。它不提供 Invocation 级 frozen snapshot（冻结快照）；并发封口的 Run 可以整体进入或整体不进入本次 reuse planning。
3. Coordination（协调）处理 execution deduplication（执行去重）、同一 Experiment 的 dispatch claim（派发占用）、全局与 Experiment 并发名额，以及 build / lease（构建 / 租约）。这些状态位于 `.niceeval/` 的 Record 外。
4. 执行时，Runner 取得 Sandbox，驱动 Agent，登记 Assertion，并形成 AssertionResult 与对应评估类型的 grading。
5. 每个 `RunWriteSession` 只写自己的 `runs/<RunId>/`。它验证 Core、固定 family closure 与 blob，flush 后才排他创建该 Run 的零字节 `complete` 完成标识。
6. Runner 返回 Invocation receipt；其 `runIds` 只包含已经发布的 Run。

已发布 Run immutable。Runner 不提供局部编辑、删除、版本校验或 Invocation 级事务；运行中的状态只存在于当前进程和 Coordination local state（协调本地状态）。

## Coordination（协调）与 Record

Record 是 durable fact（持久事实）面。它只保存每个已发布 Run 的目录、Core、fixed family closure 和
`complete` 发布点。多个 Invocation 可以向同一 root 并发追加，因为每个 writer 只拥有自己的 `RunId`
directory。

Coordination 是本地执行面。它拥有执行去重、同一 Experiment 的 dispatch claim、`maxConcurrency`、build
和 lease。它的 `.niceeval/` 状态不复制进 Record，也不由 reader、Run directory 或 `complete` 推断。

普通 reader、`show`、`view` 和 `exp --dry` 使用 shared read lease（共享读取租约）。它们只惰性读取已发布
Run；weak scan 不保证同一时刻的全局快照。`clean` 与 `migrate` 使用 exclusive maintenance lease（排他维护
租约），仍与 reader、append writer 和其它 maintenance 操作互斥。

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

`runIds` 只列已经创建 `complete` 的 Run。它不是一次 Invocation 的原子发布列表，也不会列出尚未发布的
directory。

## 调度

Runner 先展开 expected slots，再以全局和 Experiment 范围的并发限制派发。等待并发名额的 slot 没有 Attempt，也不会占用执行资源。跨 Invocation 的 execution claim 与同一 Experiment dispatch claim 由 Coordination 决定，不由 Record writer、Run directory 或 reader 决定。

调度器先让每条独立 lane 的首槽位至少获得一次全局并发机会，再允许任一 lane 的后继槽位进入派发。首槽公平完成后，lane 只受自己的 predecessor、全局限制和 Experiment 限制约束；快 lane 不等待慢 lane 的下一槽位进入同一 wave。

首过即停、预算耗尽和已声明的停止派发条件都保留 expected slot。正常停止前从未 reserved 的 slot 写作 `not-dispatched` Member，Sample 将它呈现为 `not-recorded`；Runner 不制造虚构的 Attempt 或 Verdict。

运行中发生的短状态、计数和进度只显示给当前进程。Run 或 Attempt 范围的诊断、阶段、计时、
用量与其它业务事实写入相应的固定 Core 或 family owner。

## 完成状态

一个 Run 只有在所有 Attempt、collector 与 Member 都已关闭，且没有 reserved / inflight / pending Attempt
（已预留 / 正在运行 / 待结算 Attempt）时才能 seal。`complete` 是这个 Run 的独立原子发布点；其它 Run
不等待它，也不会与它组成 Invocation 级发布。

收到 `SIGINT` 时，Runner 停止新的派发并等待资源 finalizer。已有执行 outcome 的 Attempt 原样封口；仍在飞的 reserved Attempt 以 Core `interrupted` outcome 封口，尚未 reserved 的 slot 写作 `interrupted` Member。随后 Run 通过普通 seal 发布，因此中断前已经完成的兄弟 Attempt 可以立即用 locator 读取。若这段受控收尾本身写入失败，Run 才保留为 incomplete directory。

正常、非中断收尾若发现没有 execution outcome 的 reserved 或 pending Attempt，必须严格失败。Runner 不得把它降格成
`not-dispatched` 或 `interrupted` Member，也不得发布该 Run。先前已经独立发布的 Run 保持可读；失败 receipt
同样只可列出已发布 Run。

## Carry 与 accept

carry 只在固定 Assertions 事实与 Attempt outcome 可读、且精确 payload 合法时发生。`reuseContract`
schema/domain/token 必须先满足当前 policy，随后才比较 identity、duration 与其它 gates。partial、缺失、
损坏、不支持或 domain 不同都选择执行并提供具名原因；持久判定输入的穷尽清单只由
[reuse planning](feature/experiments/cache.md#复用资格) 定义。

`niceeval accept` 先校验全部 locator，再建立含 reference Member 的 Run，并在 Member action 中写出
adoption。任一 locator 无效时不写入该批次。

资格由当前 reuse policy 计算；操作者的采用动作属于目标 Run 的 Member Core。源 Attempt 已随 origin
Run 冻结。

详细规则见 [缓存与携带](feature/experiments/cache.md)。

## 证据与固定 family

Runner 在采集前读取 Assertion 对固定 family 的需求。

- 参与 grading 的 Assertion 所需材料无法交付时，该 Assertion 为 `unavailable`，Pass 或 Score 的
  结果按 Assertion 契约处理。
- 不参与 grading 的 Assertion 仍保留 `unavailable`，但不会单独作废正式 grading。
- 只供报告使用的固定 family 读取失败时，Runner 写入具名诊断，已形成的业务数据保持原值。

采集完整度（`collection`）与读取状态由 Record reader 分开表达。每个 family 读取结果只能是
`available`、`not-recorded`、`unsupported` 或 `invalid`。Runner 不把未采集、未知 schema 或损坏
文件写成空值；可迁移的旧 root 只在 Record open 时引导 migrate。

## 生命周期与收尾

Experiment `setup` 与 `teardown` 在宿主机运行，每个 Run 最多各一次。只要进入 setup 的调用点，Runner 就尝试 teardown。Sandbox、Agent runtime、作者 cleanup 和 Provider finalizer 各自按所属生命周期收尾。

Run 范围的 setup、teardown、共享准备和停止派发信息写入 Run 的诊断或计时固定事实。它们不冒充
某个 Attempt 的数据。

超时停止继续执行，但会保留在停止前已经交付的固定事实。Runner 将 timeout 诊断写入
Attempt-owned observability 事实，并让 Assertion 与 Verdict 的正常规则决定最终状态。

## 相关阅读

- [Experiments 架构](feature/experiments/architecture.md)
- [Experiments CLI](feature/experiments/cli.md)
- [Record 架构](feature/record/architecture.md)
- [Assertions 证据](feature/assertions/architecture/evidence.md)
- [Verdict](feature/verdict/architecture.md)
- [执行失败分类](feature/error-classification/architecture.md)
