# Runner —— 执行引擎

Runner 是 `experimentHost` 后的内部执行引擎。它把已求值的 Experiment 变成完整发布的 Run，负责调度、Sandbox 生命周期与 Attempt 收尾。它通过内部 SQLite 适配器写入项目数据库，不能被 CLI 或 View 直接调用。Run 保存持久事实，固定 Inspection 操作在短读取内关闭选择和结果，`query` 与 View 各自交付该结果。

## 职责边界

Experiment 配置先进入 `experimentHost`。Host 将计划交给 Runner，Runner 建立 Run 与 expected Planned attempts，执行或采用 Attempt，并在同一项目数据库内封口 Core 与固定 family 事实。

查看时，内部 source adapter 在短 Record reader scope 内执行一个固定 operation，并在返回前关闭
source、selection、sealed cutoff、partial、missing、issues 与 Evidence。machine `query` 编码显式四态的
versioned JSON；固定 View 只消费 operation result，并在自己的 loopback session 内显示它。两者共享
`niceeval/inspection` 的协议 Schema、类型与 decoder，都不持有 reader，也不生成静态目录。

Runner 不为读取面准备聚合结果，不向 receipt 复制 Verdict、locator、用量、费用或计数。调用方按 receipt 的 `createdRunIds` 通过固定 `query` request 读取结果；人可用 `view` 深读。

## Run、Member 与 Attempt

每个选中的 Experiment 对应一个 Run。Run 的 expected Planned attempts 决定本次分母；每个 Planned attempt 最多对应一个 Member。

| Core relationship | Runner 行为 |
|---|---|
| `origin` | 本 Run 实际执行 Attempt，并建立唯一 origin Member。 |
| `reference` | 当前 Planned attempt 精确引用已发布 Attempt，不复制 payload。 |

Attempt 的 origin 永远是实际执行它的 Run。reference Member 不复制 AssertionResult、grading、usage、conversation、diff 或 artifact。

Run Core 的 Member action 保存 reuse、adoption 或 rename 的上下文和理由，并以 `plannedAttemptId`、`attemptId` 关联。它不是一份额外的 provenance family。

## 运行顺序

1. `experimentHost` 进入 Runner。Runner 为每个目标 Run 分配 `RunId`、`startedAt` 和完整 expected Planned attempts。每个 Planned attempt 将当前 zero-based attempt number 直接写入 durable `attemptOrdinal`，不从顺序推断。
2. Runner 在同一 `PublicationCutoff` 下读取候选历史 Run。它不提供跨 Invocation 的全局冻结快照，并发封口的 Run 可以整体进入或整体不进入本次 reuse planning。
3. Coordination（协调）处理 execution deduplication（执行去重）、同一 Experiment 的 dispatch claim（派发占用）、全局与 Experiment 并发名额，以及 build / lease（构建 / 租约）。这些运行态与已发布事实写入同一个 `.niceeval/record.sqlite`，由行状态、writer generation 与 cutoff 隔离。
4. 派发前，Runner 构建 gaps 需要的 BuildKey，并为 `RunPrepared` Provider 的配对结算[准备图](concepts.md#before-cache-preparation-graph)。全部结算后才派发（见 [Before cache](feature/sandbox/architecture/before-cache.md)）。
5. 执行时，Runner 取得 Sandbox，驱动 Agent，登记 Assertion，并形成 AssertionResult 与对应评估类型的 grading。
6. 每个 Attempt 在短事务内提交 immutable closure 与 Planned attempt binding，并推进单调 publication revision。Run 收口时在同一事务内提交终态与剩余 absence reason。
7. Runner 返回 Invocation receipt。其 `createdRunIds` 穷尽本次调用创建的 Run，并带上调用结束时的 `publicationCutoff`。

已发布 Attempt 与已收口 Run 不可变。Runner 不提供局部编辑、删除、版本校验或 Invocation 级事务。运行中的未发布状态只通过行状态、writer generation 与 project barrier 隔离。

## Coordination（协调）与 Record

Record 是 durable fact（持久事实）面。它在项目内唯一 `.niceeval/record.sqlite` 中保存每个 Run 的创建、Attempt 发布、Planned attempt binding 与终态收口。多个 Invocation 可以并发追加，因为每次写操作只走带 generation 校验的短事务。

Coordination 是运行协调面。它拥有执行去重、同一 Experiment 的 dispatch claim、`maxConcurrency`、build 和 lease。这些协调行不进入公开读取结果，也不由 reader 或终态反推。

`query`、`show`、`view` 和 `exp --dry` 在固定 `PublicationCutoff` 上只读取已发布的事实与绑定。未发布 aggregate、sealing 行与晚于 cutoff 的变更对读取不可见。格式升级在项目写入口打开时自动完成，受控退出时通过 portable gate 交付可移动单文件，不设独立的手动维护命令。

## Invocation receipt

~~~ts
interface InvocationReceipt {
  readonly invocationId: string;
  readonly createdRunIds: readonly string[];
  readonly publicationCutoff: string;

  readonly startedAt: string;
  readonly completedAt?: string;
  readonly completion: "completed" | "interrupted" | "failed";
}
~~~

receipt 只标识这次调用及其 Run。它不是第二份结果文件，也不带页面需要的业务数据。终端反馈与 `--json` 的 progress 同样只属于当前进程。

`createdRunIds` 穷尽包含已提交 create transaction 的 Run；`publicationCutoff` 的语义见 [Invocation receipt](feature/experiments/architecture/README.md#invocation-receipt-与退出)。

## 调度

全局并发名额和实验并发限制共同决定该 Experiment 的有效宽度。

Runner 先展开 expected Planned attempts，等准备图全部结算，再以全局和 Experiment 范围的并发限制派发。准备节点的并发受 `maxBeforeCacheConcurrency` 与 Provider `scheduling.lane.limit` 约束，不占用 `maxConcurrency` 名额。等待并发名额的 Planned attempt 没有 Attempt，也不会占用执行资源。跨 Invocation 的 execution claim 与同一 Experiment dispatch claim 由 Coordination 决定，不由 reader 或终态决定。

带 Docker profile的 DinD还要经过 watchdog跨进程准入。Runner提交 CPU、memory、PID、container和
`ephemeralDiskBytes`完整向量；只有 watchdog同时授予容量与私有 Docker data allocation后才创建 Attempt。等待这笔
准入不占用 Docker资源，且不能用稀疏文件 apparent size增加可授予磁盘容量。

调度器先让每条独立 lane 的首槽位至少获得一次全局并发机会，再允许任一 lane 的后继槽位进入派发。首槽公平完成后，lane 只受自己的 predecessor、全局限制和 Experiment 限制约束；快 lane 不等待慢 lane 的下一槽位进入同一 wave。

首过即停、预算耗尽和已声明的停止派发条件都保留 expected Planned attempt。正常停止前从未 reserved 的 Planned attempt 写作 `not-dispatched` Member，Sample 将它呈现为 `not-recorded`；Runner 不制造虚构的 Attempt 或 Verdict。依赖失败准备节点的 Planned attempt 同样不派发，错误原因由关联该 Planned attempt 的 `sandbox-before-cache-failed` Run 级诊断说明（见[执行失败分类 · 止损语义](feature/error-classification/README.md#止损语义)）。

运行中发生的短状态、计数和进度只显示给当前进程。Run 或 Attempt 范围的诊断、阶段、计时、
用量与其它业务事实写入相应的固定 Core 或 family owner。

## 完成状态

一个 Run 只有在所有 Attempt、collector 与 Member 都已关闭，且没有 reserved / inflight / pending Attempt
（已预留 / 正在运行 / 待结算 Attempt）时才能收口。Run close 是这个 Run 的独立原子发布点。其它 Run
不等待它，也不会与它组成 Invocation 级发布。

收到 `SIGINT` 时，Runner 停止新的派发并等待资源 finalizer。仍在准备的节点停止并回收 staging，已发布的 Before cache artifact 保留。已有执行 outcome 的 Attempt 原样封口，仍在飞的 reserved Attempt 以 Core `interrupted` outcome 封口，尚未 reserved 的 Planned attempt 写作 `interrupted` Member。随后 Run 通过 close 事务收口，因此中断前已经完成的兄弟 Attempt 可以立即用 locator 读取。若这段受控收尾本身写入失败，Run 保持 `active`，等待后续 recover 收口。

正常、非中断收尾若发现没有 execution outcome 的 reserved 或 pending Attempt，必须严格失败。Runner 不得把它降格成
`not-dispatched` 或 `interrupted` Member，也不得收口该 Run。先前已经独立发布的 Attempt 与 Run 保持可读；失败 receipt
同样只可列出已创建的 Run。

## Carry 与 accept

carry 只在固定 Assertions 事实与 Attempt outcome 可读、且精确 payload 合法时发生。`reuseContract`
schema/domain/token 必须先满足当前 policy，随后才比较 identity、duration 与其它条件。partial、缺失、
损坏、不支持或 domain 不同都选择执行并提供具名原因；持久判定输入的穷尽清单只由
[reuse planning](feature/experiments/architecture/cache.md#复用资格) 定义。

`niceeval accept` 先校验全部 locator，再建立含 reference Member 的 Run，并在 Member action 中写出
adoption。任一 locator 无效时不写入该批次。

资格由当前 reuse policy 计算；操作者的采用动作属于目标 Run 的 Member Core。源 Attempt 已随 origin
Run 冻结。
当前目标先判定结果可用性与 gap，再应用执行选项。符合有限规则的采用在相同目标下可经见证重验后继续沿用；
目标再次变化则重新判断。缺口、强制重跑动作与 Invocation 完成度分别解释，不用历史评分填补当前缺口。

详细规则见 [缓存与携带](feature/experiments/architecture/cache.md)。

## 证据与固定 family

Runner 在采集前读取 Assertion 对固定 family 的需求。

- 参与 grading 的 Assertion 所需材料无法交付时，该 Assertion 为 `unavailable`，Pass 或 Score 的
  结果按 Assertion 契约处理。
- 不参与 grading 的 Assertion 仍保留 `unavailable`，但不会单独作废正式 grading。
- 只供报告使用的固定 family 读取失败时，Runner 写入具名诊断，已形成的业务数据保持原值。

采集完整度（`collection`）与读取状态由 Record reader 分开表达。每个 family 读取结果只能是
`available`、`not-recorded`、`unsupported` 或 `invalid`。Runner 不把未采集、未知 schema 或损坏
内容写成空值；已知历史格式在项目数据库打开时自动迁移。

## 生命周期与收尾

Experiment 的 `before` 与 `after` 在宿主机运行，每个 Run 最多各一次。只要进入 `before` 的调用点，Runner 就尝试 `after`。Sandbox、Agent runtime、作者收尾回调和 Provider finalizer 各自按所属生命周期收尾。

Run 范围的 `before`、`after`、共享准备和停止派发信息写入 Run 的诊断或计时固定事实。它们不冒充
某个 Attempt 的数据。

超时停止继续执行，但会保留在停止前已经交付的固定事实。Runner 将 timeout 诊断写入
Attempt-owned observability 事实，并让 Assertion 与 Verdict 的正常规则决定最终状态。

## 相关阅读

- [Experiments 架构](feature/experiments/architecture/README.md)
- [Experiments CLI](feature/experiments/cli/README.md)
- [Record 架构](feature/run/architecture/README.md)
- [Assertions 证据](feature/assertions/architecture/evidence.md)
- [Verdict](feature/verdict/architecture.md)
- [执行失败分类](feature/error-classification/architecture.md)
